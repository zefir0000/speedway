# Speedway — własny serwer, WebSocket, MySQL i Redis

Ta paczka uruchamia samodzielny serwer bez Dockera. `npm start` korzysta z WebSocket, MySQL i Redis. Wersja hostowana na Sites zachowuje poprzednie API HTTP/D1; nie jest automatycznie przełączana na Twój serwer.

## Podział odpowiedzialności

| Warstwa | Dane i działanie |
| --- | --- |
| Node.js, pamięć procesu | Autorytatywna fizyka 120 Hz, sterowanie, falstarty, kolizje, mety. |
| WebSocket | Komendy od graczy, wspólny stan biegu 20 razy/s, heartbeat i wznowienie połączenia. |
| Redis | Kolejka graczy, przydział do biegów, bilety, kopie stanu co sekundę i kolejka wyników czekających na MySQL. |
| MySQL | Rekordy, kampanie i końcowe wyniki online z zawodnikami i czasami. |

Fizyka i komendy nie czekają na MySQL ani na zapis każdej klatki w Redis. Wolny zapis wyniku jest ponawiany poza pętlą jazdy. Klient przewiduje własny ruch i interpoluje pozycje rywali z buforem 100 ms. Wynik biegu zatwierdza serwer. Klient nie może wysyłać własnych pozycji ani wyniku online.

Ta wersja wymaga **jednego procesu Node** na przestrzeń nazw Redis. PM2 ma `instances: 1` i `fork`; blokada właściciela w Redis zapobiega przypadkowemu uruchomieniu dwóch niezależnych silników. To nie jest jeszcze konfiguracja wielu instancji ani automatyczny podział biegów między serwery.

## Wymagania

- Node.js **22.13 lub nowszy**; weryfikacja została wykonana na Node 24.
- MySQL **8.0+**.
- Redis **6.2+**; weryfikacja na Redis 7.0.15 i MySQL 8.0.
- Nginx z HTTPS, opcjonalnie PM2 do nadzoru procesu.

Dla nowej instalacji użyj Ubuntu 22.04/24.04 lub porównywalnego aktualnego systemu. Ubuntu 18.04 z GLIBC 2.27 nie obsługuje standardowych współczesnych binariów Node używanych w tej paczce — wymaga aktualizacji systemu. Nie używaj Node 16.

## Instalacja

Rozpakuj paczkę jako użytkownik uruchamiający aplikację, np. do `/srv/speedway`. Polecenia aplikacji wykonuj w tym katalogu.

```sh
npm ci
cp .env.example .env
openssl rand -hex 32
```

Wpisz wynik generatora do `SESSION_SECRET`. W `.env` ustaw również `PUBLIC_ORIGIN` na dokładny adres HTTPS gry, hasło i użytkownika MySQL oraz `REDIS_URL`. `.env` nie trafia do Git ani paczki wydaniowej. Nie zmieniaj `SESSION_SECRET` przy zwykłej aktualizacji: podpisuje on sesje urządzeń i ich dostęp do kampanii.

Przygotuj bazę i użytkownika jako administrator MySQL. Przykład jest w `deploy/mariadb-setup.sql.example`; zamień przykładowe hasło na własne. Jeśli użytkownik ma już uprawnienia do właściwej bazy, nie trzeba tworzyć go ponownie.

Redis powinien być lokalny albo dostępny wyłącznie w prywatnej sieci. Przykład `deploy/redis.conf.example` włącza AOF i `noeviction`. Kolejka wyników musi przetrwać restart; nie stosuj polityki wyrzucającej jej klucze. `appendfsync everysec` może utracić około sekundy ostatnich zmian przy awarii zasilania. Regularnie wykonuj kopie MySQL i Redis.

```sh
npm run db:migrate
npm run build
npm start
```

Migracje są wersjonowane, powtarzalne i uruchamiane także przy starcie. Nie zmieniaj już zaaplikowanego pliku SQL — kolejne zmiany dodawaj jako nową migrację. Serwer domyślnie nasłuchuje wyłącznie na `127.0.0.1:3000`.

## PM2 i Nginx

```sh
SPEEDWAY_NODE=/pelna/sciezka/do/node pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

Wykonaj polecenie wyświetlone przez `pm2 startup`, żeby włączyć start po restarcie systemu. Konfiguracja wskazuje katalog aplikacji, wczytuje `.env` i uruchamia jeden proces. Wskaż rzeczywistą ścieżkę Node 22.13+, również jeśli korzystasz z nvm.

Dostosuj domenę i ścieżki certyfikatów w `deploy/nginx.conf.example`. Blok `map` musi znajdować się w kontekście `http`, a nagłówki `Upgrade` i `Connection` muszą być przekazywane do Node. Następnie:

```sh
sudo nginx -t
sudo systemctl reload nginx
curl https://twoja-domena.pl/healthz
curl https://twoja-domena.pl/readyz
```

`/healthz` sprawdza działanie procesu, `/readyz` także gotowość Redis i MySQL. Nie wystawiaj portów baz do Internetu. Nie potrzeba Dockera ani zewnętrznego tunelu.

## Rozgrywka i odporność na awarie

Jedna kolejka, cztery miejsca, losowany wspólny tor. Komplet graczy rozpoczyna przygotowanie biegu od razu. Po 20 sekundach od wejścia pierwszego gracza brakujące miejsca zajmują oznaczone boty. Po zgaśnięciu czerwonego światła pierwsze kliknięcie uruchamia motocykl, następne przytrzymanie skręca. Falstart wyklucza tylko tego zawodnika.

Bieg trwa do mety wszystkich niewykluczonych zawodników; limit całego biegu wynosi trzy minuty. Każdy klient otrzymuje ten sam wynik i podium. Po utracie połączenia bot przejmuje motocykl po pięciu sekundach; powrót w tej samej karcie pozwala odzyskać miejsce i numer ostatniej komendy. Zamykanie karty może usunąć jej bilet zapisany w `sessionStorage`.

Wyniki trafiają najpierw do kolejki Redis Streams, następnie do transakcji MySQL. Ponowienie po utracie potwierdzenia nie tworzy duplikatu meczu ani jego zawodników. Gdy MySQL jest czasowo niedostępna, aktywne biegi nadal działają, a wyniki czekają w Redis. Przy dłuższej awarii trzeba monitorować pamięć Redis i jego kolejkę; `noeviction` nie usuwa danych, ale pełny Redis odmówi nowych zapisów.

Krótka przerwa w Redis nie zatrzymuje od razu aktywnych biegów w RAM. Po wygaśnięciu blokady właściciela proces kończy pracę, aby nie uruchomić dwóch konkurujących silników. PM2 restartuje go po powrocie usług. Stan biegów jest odtwarzany z ostatnich kopii Redis; przerwa dłuższa niż pięć sekund może uruchomić boty. Na starcie MySQL i Redis muszą być dostępne.

Sesje są anonimowe i związane z podpisanym ciasteczkiem urządzenia. Kampanie są oddzielone między urządzeniami, a tablica czasów jest wspólna. Ta wersja nie wprowadza kont i logowania ani przenoszenia kampanii między telefonami. Rekordów online nie mieszamy z czasami zgłaszanymi przez tryb lokalny.

## Aktualizacja

```sh
npm ci
npm run db:migrate
npm run build
pm2 restart speedway
```

Zachowaj `.env`, bazę MySQL, dane Redis i tę samą przestrzeń `REDIS_PREFIX`. Restart chwilowo rozłączy graczy; najlepiej aktualizować między biegami. Redis przechowuje stan wznowienia, ale nie zapewnia restartu bez przerwy w połączeniu.

Istniejące dane wersji Sites/D1 pozostają tam. Ta paczka nie przenosi ich automatycznie do MySQL. Przed docelowym przełączeniem domeny trzeba osobno wykonać eksport i import rekordów oraz kampanii; nie kasuj działającej bazy Sites.

## Testy

```sh
npm run test:server
npm run test:online
```

Pierwsze testy sprawdzają konfigurację, sesje i ukończenie biegów na wszystkich torach; drugie zachowują sprawdzenie pełnego biegu poprzedniego klienta Sites.

Test integracyjny używa prawdziwych usług i dedykowanej bazy z końcówką `_test`. Nie uruchamiaj go na bazie produkcyjnej.

```sh
INTEGRATION=1 \
TEST_MYSQL_HOST=127.0.0.1 \
TEST_MYSQL_PORT=3306 \
TEST_MYSQL_USER=twoj_uzytkownik_testowy \
TEST_MYSQL_PASSWORD=twoje_haslo_testowe \
TEST_MYSQL_DATABASE=speedway_test \
TEST_REDIS_URL=redis://127.0.0.1:6379 \
npm run test:integration
```

Sprawdza czterech klientów WebSocket z kodem przeglądarki, rzeczywiste okrążenia, wspólne podium, niezależne sterowanie ostatniego zawodnika, grupowanie ośmiu graczy, boty po 20 sekundach, falstarty, ponowienia komend, powrót po rozłączeniu, odzyskanie stanu po restarcie, zapisy i własność kampanii, idempotencję wyników, kolejkę zapisów po awarii oraz brak blokowania fizyki przez wolne zapytanie SQL. Klient przeglądarki działa w kontrolowanym środowisku JavaScript; nie jest to pomiar FPS na prawdziwym telefonie.

```sh
npm run release
```

Buduje paczkę wdrożeniową z kodem, klientem, migracjami, przykładami konfiguracji i instrukcją. Nie dołącza `node_modules`, `.env`, baz danych ani danych sesji.

## Dokumentacja użytych komponentów

- MySQL Connector/Node.js: https://dev.mysql.com/doc/dev/connector-nodejs/
- Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
- Node Redis: https://redis.io/docs/latest/develop/clients/nodejs/connect/
- WebSocket `ws`: https://github.com/websockets/ws
