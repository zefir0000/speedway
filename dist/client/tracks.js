'use strict';
const TRACKS = [
 {id:'classic',name:'Korona',description:'Dwie proste, szerokie łuki',half:175,radius:195,width:166,asymmetry:0,clay:'#a18960',groove:'#bc9e70',shade:'#6e593a',grass:'#30482f',grassStripe:'#365132',surround:'#182923',fence:'#d9c79a',accent:'#f1ce63'},
 {id:'long',name:'Kuźnia',description:'Długie proste, ciaśniejsze łuki',half:245,radius:178,width:112,asymmetry:0,clay:'#b27550',groove:'#e0a274',shade:'#6e4229',grass:'#304234',grassStripe:'#3b4b37',surround:'#182722',fence:'#edc4a4',accent:'#edaa77'},
 {id:'arena',name:'Aurora',description:'Krótka prosta, dużo miejsca',half:42,radius:215,width:190,asymmetry:0,clay:'#849ca3',groove:'#b5cbd1',shade:'#4c646d',grass:'#253f42',grassStripe:'#2d4a4d',surround:'#152b30',fence:'#d4e9ec',accent:'#93d5e3'},
 {id:'narrow',name:'Bastion',description:'Mniej miejsca na wyprzedzanie',half:185,radius:195,width:90,asymmetry:0,clay:'#bca779',groove:'#e0cf9f',shade:'#7d6e48',grass:'#414831',grassStripe:'#4d533a',surround:'#25291b',fence:'#f0e6c7',accent:'#ded497'},
 {id:'asymmetric',name:'Feniks',description:'Dwa różne łuki, ukośne proste',half:178,radius:202,width:134,asymmetry:27,clay:'#9e7273',groove:'#cfa0a0',shade:'#633c40',grass:'#343848',grassStripe:'#3c4353',surround:'#212333',fence:'#edd0cd',accent:'#e6aaaa'}
];
function makeTrackGeometry(track,cx=500,cy=330){
 const tau=Math.PI*2;
 function profile(radius){const left=radius-track.asymmetry,right=radius+track.asymmetry,d=track.half*2,nx=d?-(right-left)/d:0,ny=Math.sqrt(1-nx*nx),a=Math.acos(nx),straight=Math.sqrt(Math.max(0,d*d-(right-left)**2)),lx=cx-track.half,rx=cx+track.half;
 return {left,right,lx,rx,nx,ny,a,straight,length:2*straight+2*a*right+(tau-2*a)*left,lb:{x:lx+left*nx,y:cy+left*ny},rb:{x:rx+right*nx,y:cy+right*ny},lt:{x:lx+left*nx,y:cy-left*ny},rt:{x:rx+right*nx,y:cy-right*ny}}}
 const wrap=(n,length)=>((n%length)+length)%length;
 function point(distance,radius=track.radius){const p=profile(radius);let q=wrap(distance+p.straight/2,p.length);
 if(q<p.straight){const t=q/p.straight;return {x:p.lb.x+(p.rb.x-p.lb.x)*t,y:p.lb.y+(p.rb.y-p.lb.y)*t}}q-=p.straight;
 if(q<2*p.a*p.right){const a=p.a-q/p.right;return {x:p.rx+p.right*Math.cos(a),y:cy+p.right*Math.sin(a)}}q-=2*p.a*p.right;
 if(q<p.straight){const t=q/p.straight;return {x:p.rt.x+(p.lt.x-p.rt.x)*t,y:p.rt.y+(p.lt.y-p.rt.y)*t}}q-=p.straight;
 const a=-p.a-q/p.left;return {x:p.lx+p.left*Math.cos(a),y:cy+p.left*Math.sin(a)};}
 function project(x,y,radius=track.radius){const p=profile(radius);let best=null;
 function candidate(px,py,nx,ny,q){const distSq=(x-px)**2+(y-py)**2;if(!best||distSq<best.distSq)best={x:px,y:py,nx,ny,distSq,offset:(x-px)*nx+(y-py)*ny,phase:wrap(q-p.straight/2,p.length)/p.length*tau};}
 function line(from,to,nx,ny,q){const dx=to.x-from.x,dy=to.y-from.y,lenSq=dx*dx+dy*dy;if(lenSq<1e-8)return;const t=Math.max(0,Math.min(1,((x-from.x)*dx+(y-from.y)*dy)/lenSq));candidate(from.x+dx*t,from.y+dy*t,nx,ny,q+t*p.straight)}
 line(p.lb,p.rb,p.nx,p.ny,0);line(p.rt,p.lt,p.nx,-p.ny,p.straight+2*p.a*p.right);
 const ar=Math.max(-p.a,Math.min(p.a,Math.atan2(y-cy,x-p.rx)));candidate(p.rx+p.right*Math.cos(ar),cy+p.right*Math.sin(ar),Math.cos(ar),Math.sin(ar),p.straight+(p.a-ar)*p.right);
 let al=Math.atan2(y-cy,x-p.lx);if(al>0)al-=tau;al=Math.max(p.a-tau,Math.min(-p.a,al));candidate(p.lx+p.left*Math.cos(al),cy+p.left*Math.sin(al),Math.cos(al),Math.sin(al),2*p.straight+2*p.a*p.right+(-p.a-al)*p.left);
 return best;}
 function path(ctx,radius){const p=profile(radius);ctx.beginPath();ctx.moveTo(p.lb.x,p.lb.y);ctx.lineTo(p.rb.x,p.rb.y);ctx.arc(p.rx,cy,p.right,p.a,-p.a,true);ctx.lineTo(p.lt.x,p.lt.y);ctx.arc(p.lx,cy,p.left,-p.a,p.a-tau,true);ctx.closePath()}
 const outer=track.radius+track.width/2,extent=outer+Math.abs(track.asymmetry);return {profile,point,project,path,length:r=>profile(r??track.radius).length,worldWidth:2*(track.half+extent)+88,worldHeight:2*extent+80};
}
