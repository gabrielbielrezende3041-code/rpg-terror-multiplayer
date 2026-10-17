const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SAVE_PATH = path.join(__dirname, 'campaigns.json');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, service: 'RPG Terror Multiplayer' }));

const rooms = new Map();
const roomNames = ['Palco', 'Corredor Oeste', 'Corredor Leste', 'Cozinha', 'Área das Mesas', 'Entrada dos Banheiros', 'Cleaning Room', 'Sala de Segurança', 'Cabaré Cove'];
const adjacency = {
  'Palco': ['Área das Mesas', 'Cabaré Cove'],
  'Área das Mesas': ['Palco', 'Cozinha', 'Corredor Oeste', 'Corredor Leste'],
  'Corredor Oeste': ['Área das Mesas', 'Sala de Segurança', 'Entrada dos Banheiros'],
  'Corredor Leste': ['Área das Mesas', 'Sala de Segurança', 'Cozinha'],
  'Cozinha': ['Área das Mesas', 'Corredor Leste', 'Cleaning Room'],
  'Entrada dos Banheiros': ['Corredor Oeste', 'Cleaning Room'],
  'Cleaning Room': ['Cozinha', 'Entrada dos Banheiros'],
  'Sala de Segurança': ['Corredor Oeste', 'Corredor Leste'],
  'Cabaré Cove': ['Palco']
};
const animatronicDefaults = [
  {name:'Gege Akutami', category:'A • Pacífico', room:'Palco', status:'No palco', state:'idle'},
  {name:'Robin', category:'A • Pacífico', room:'Palco', status:'Vibração 0%', state:'idle', vibration:0},
  {name:'Maomao', category:'A • Pacífico', room:'Cozinha', status:'Escondida', state:'hidden'},
  {name:'Felix', category:'C • Conversável', room:'Cabaré Cove', status:'Feliz', state:'Feliz'},
  {name:'MalO', category:'B • Hostil', room:'Corredor Oeste', status:'Aguardando o Mestre', state:'idle'},
  {name:'Vaporeon', category:'B • Hostil', room:'Corredor Leste', status:'Aguardando o Mestre', state:'idle'},
  {name:'Suguru Geto', category:'A • Pacífico', room:'Palco', status:'Indo para Cleaning Room', state:'moving', origin:'Palco', returnUnlocked:false},
  {name:'Satoru Gojo', category:'B • Hostil', room:'Corredor Leste', status:'Restrição ativa', state:'restricted', deactivatedUntilNight:0}
];
function newRoom(code, masterId, masterName) {
  const state = {
    code, masterId, masterName, players: {}, energy: 20, doors: {left:'open',right:'open'},
    round: 1, night: 1, hour: 12, minute: 0, turnQueue: [], currentTurn: null, masterTurn: false,
    started: false, ended: false, winner: null, logs: [], cameras: ['Palco','Corredor Oeste','Corredor Leste','Cozinha','Área das Mesas','Entrada dos Banheiros','Cleaning Room','Cabaré Cove'],
    animatronics: JSON.parse(JSON.stringify(animatronicDefaults)),
    gege: {agreement:null, eventDone:false, d20:null},
    maomao: {found:false, room:'Cozinha', startRoom:'Sala de Segurança', usualRoom:'Cozinha'},
    config: {nightStartHour:12, nightEndHour:18},
    adjacency
  };
  state.players[masterId] = {id:masterId, name:masterName || 'Mestre', avatar:null, room:'Sala de Segurança', alive:true, role:'master', connected:true};
  return state;
}
function log(room, message) { room.logs.unshift({at:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}), message}); room.logs = room.logs.slice(0,80); }
function publicState(room, viewerId) {
  const master = room.masterId === viewerId;
  const players = Object.values(room.players).map(p => ({id:p.id,name:p.name,avatar:p.avatar,room: master || p.id===viewerId ? p.room : 'Desconhecido',alive:p.alive,role:p.role,connected:p.connected}));
  const animatronics = room.animatronics.map(a => ({...a, room: master ? a.room : (a.name==='Maomao' && !room.maomao.found ? 'Desconhecido' : a.room)}));
  return {code:room.code, masterId:room.masterId, masterName:room.masterName, isMaster:master, players, energy:room.energy, doors:room.doors, round:room.round, night:room.night, hour:room.hour, minute:room.minute, currentTurn:room.currentTurn, masterTurn:room.masterTurn, started:room.started, ended:room.ended, winner:room.winner, logs:room.logs, cameras:room.cameras, animatronics, adjacency:room.adjacency, myPlayer:room.players[viewerId], gege:room.gege, maomao:master ? room.maomao : {found:room.maomao.found}, config:room.config};
}
function emitRoom(room) { for (const id of Object.keys(room.players)) io.to(id).emit('state', publicState(room,id)); }
function fail(socket,msg){socket.emit('notice',{type:'error',message:msg});}
function findRoom(socket) { const code=socket.data.room; return code ? rooms.get(code) : null; }
function isMaster(socket, room) { return room && room.masterId===socket.id; }
function consumeTurn(room, player) {
  if (!room.started || room.ended) return 'A partida não está ativa.';
  if (!player.alive) return 'Seu personagem está morto nesta noite.';
  if (room.masterTurn || room.currentTurn !== player.id) return 'Não é seu turno.';
  room.currentTurn = null;
  const next = room.turnQueue.shift();
  if (next) room.currentTurn = next;
  else { room.masterTurn = true; room.currentTurn = null; }
  return null;
}
function advanceRound(room) {
  room.masterTurn = false;
  room.round++;
  if ((room.round-1)%2===0) { room.hour=(room.hour+1)%24; if(room.hour===room.config.nightEndHour){room.ended=true; room.winner='Mestre'; log(room,'A noite terminou. O Mestre venceu.'); return;} }
  room.turnQueue = Object.values(room.players).filter(p=>p.role==='player'&&p.alive&&p.connected).map(p=>p.id);
  room.currentTurn = room.turnQueue.shift() || null;
  if (!room.currentTurn) room.masterTurn = true;
  // Robin's automatic increase occurs once after each player turn and once after each Master turn.
}
function getAnim(room,name){return room.animatronics.find(a=>a.name===name);}
function bfsNext(room, from, to) {
  if(from===to)return from;
  const queue=[[from]]; const seen=new Set([from]);
  while(queue.length){const p=queue.shift(), n=p[p.length-1]; for(const x of room.adjacency[n]||[]){if(seen.has(x))continue;const np=[...p,x];if(x===to)return np[1];seen.add(x);queue.push(np);}}
  return from;
}
function autoRobin(room){const r=getAnim(room,'Robin'); if(r) {r.vibration=Math.min(100,(r.vibration||0)+10);r.status=`Vibração ${r.vibration}%`;}}
function turnComplete(room, player) {
  if (!room.started || room.ended) return 'A partida não está ativa.';
  if (!player.alive) return 'Seu personagem está morto nesta noite.';
  if (room.masterTurn || room.currentTurn !== player.id) return 'Não é seu turno.';
  autoRobin(room);
  const err=consumeTurn(room,player); if(err)return err;
  if(room.masterTurn) log(room,'Todos os jogadores concluíram suas vezes. É o turno do Mestre.');
  return null;
}
function saveSnapshot(){try{fs.writeFileSync(SAVE_PATH,JSON.stringify([...rooms.entries()].map(([code,r])=>({code,night:r.night,round:r.round,energy:r.energy,doors:r.doors,ended:r.ended,logs:r.logs})),null,2));}catch(e){console.error('Não foi possível salvar campanhas:',e.message)}}

io.on('connection', socket => {
  socket.on('createRoom', ({name}) => {
    let code; do {code=crypto.randomBytes(3).toString('hex').toUpperCase();} while(rooms.has(code));
    const room=newRoom(code,socket.id,String(name||'Mestre').slice(0,24)); rooms.set(code,room); socket.data.room=code; socket.join(code);
    log(room,`${room.masterName} criou a partida ${code}.`); socket.emit('joined',{code,role:'master'}); emitRoom(room); saveSnapshot();
  });
  socket.on('joinRoom', ({code,name,avatar}) => {
    code=String(code||'').trim().toUpperCase(); const room=rooms.get(code);
    if(!room)return fail(socket,'Código de partida não encontrado.');
    if(room.ended)return fail(socket,'Esta partida já terminou.');
    if(Object.keys(room.players).filter(id=>room.players[id].role==='player').length>=8)return fail(socket,'Esta partida já possui 8 jogadores.');
    const player={id:socket.id,name:String(name||'Jogador').slice(0,24),avatar:typeof avatar==='string'&&avatar.startsWith('data:image/')&&avatar.length<500000?avatar:null,room:'Sala de Segurança',alive:true,role:'player',connected:true};
    room.players[socket.id]=player; socket.data.room=code; socket.join(code); log(room,`${player.name} entrou na partida.`);
    socket.emit('joined',{code,role:'player'}); if(room.started&&!room.masterTurn&&!room.currentTurn)room.currentTurn=socket.id; emitRoom(room); saveSnapshot();
  });
  socket.on('startGame',()=>{const r=findRoom(socket);if(!isMaster(socket,r))return fail(socket,'Somente o Mestre pode iniciar.');if(r.started)return; r.started=true;r.turnQueue=Object.values(r.players).filter(p=>p.role==='player'&&p.alive&&p.connected).map(p=>p.id);r.currentTurn=r.turnQueue.shift()||null;r.masterTurn=!r.currentTurn;log(r,'A noite começou. Energia inicial: 20/20.');emitRoom(r);saveSnapshot();});
  socket.on('move',({room:target})=>{const r=findRoom(socket),p=r?.players[socket.id];if(!r||!p||p.role!=='player')return;if(!r.adjacency[p.room]?.includes(target))return fail(socket,'Você só pode andar para uma sala adjacente.');const err=turnComplete(r,p);if(err)return fail(socket,err);p.room=target;log(r,`${p.name} se movimentou para ${target}.`);checkPresenceAttacks(r,p);emitRoom(r);saveSnapshot();});
  socket.on('camera',({room:target,opening})=>{const r=findRoom(socket),p=r?.players[socket.id];if(!r||!p||p.role!=='player')return;if(!p.alive)return fail(socket,'Seu personagem está morto.');if(!r.started||r.ended)return fail(socket,'A partida não está ativa.');if(r.masterTurn||r.currentTurn!==p.id)return fail(socket,'Você só pode usar câmeras durante seu turno liberado.');if(r.energy<1)return fail(socket,'Energia insuficiente.');if(!r.cameras.includes(target))return fail(socket,'Câmera inválida.');r.energy--;log(r,`${p.name} ${opening?'abriu':'trocou para'} a câmera: ${target} (-1 energia).`);socket.emit('cameraView',{room:target,animatronics:r.animatronics.filter(a=>a.room===target&&!(a.name==='Maomao'&&!r.maomao.found)).map(a=>({name:a.name,status:a.status}))});emitRoom(r);saveSnapshot();});
  socket.on('door',({side})=>{const r=findRoom(socket),p=r?.players[socket.id];if(!r||!p||p.role!=='player')return;if(side!=='left'&&side!=='right')return fail(socket,'Porta inválida.');if(r.doors[side]==='closed')return fail(socket,'Essa porta já está fechada.');if(r.energy<1)return fail(socket,'Energia insuficiente.');const err=turnComplete(r,p);if(err)return fail(socket,err);r.energy--;r.doors[side]='closed';r.doors[side==='left'?'right':'left']='open';log(r,`${p.name} fechou a porta ${side==='left'?'esquerda':'direita'}; a porta oposta abriu automaticamente (-1 energia).`);emitRoom(r);saveSnapshot();});
  socket.on('reduceRobin',()=>{const r=findRoom(socket),p=r?.players[socket.id];if(!r||!p||p.role!=='player')return;const robin=getAnim(r,'Robin');if(!robin)return;const err=turnComplete(r,p);if(err)return fail(socket,err);robin.vibration=Math.max(0,robin.vibration-30);robin.status=`Vibração ${robin.vibration}%`;log(r,`${p.name} reduziu a vibração de Robin em 30 pontos percentuais.`);emitRoom(r);});
  socket.on('endPlayerTurn',()=>{const r=findRoom(socket),p=r?.players[socket.id];if(!r||!p||p.role!=='player')return;const err=turnComplete(r,p);if(err)return fail(socket,err);log(r,`${p.name} encerrou seu turno.`);emitRoom(r);});
  socket.on('masterAction',(data)=>{const r=findRoom(socket);if(!isMaster(socket,r))return fail(socket,'Ação exclusiva do Mestre.');const {action,name,value,target}=data||{};
    if(action==='moveAnim'){const a=getAnim(r,name);if(!a||!r.adjacency[a.room]?.includes(target))return fail(socket,'Movimento inválido: escolha uma sala adjacente.');a.room=target;a.status='Movido pelo Mestre';if(a.name==='Suguru Geto'&&target==='Cleaning Room'){a.returnUnlocked=true;a.status='Chegou à Cleaning Room';}if(a.name==='Satoru Gojo'&&target.startsWith('Corredor'))a.status='No corredor';log(r,`Mestre moveu ${name} para ${target}.`);}
    else if(action==='setState'){const a=getAnim(r,name);if(!a)return;if(a.name==='Felix'&&!['Feliz','Médio','Raiva'].includes(value))return fail(socket,'Estado de Felix inválido.');a.state=value;a.status=value;log(r,`Mestre alterou ${name}: ${value}.`);}
    else if(action==='setVibration'){const a=getAnim(r,'Robin');a.vibration=Math.max(0,Math.min(100,Number(value)||0));a.status=`Vibração ${a.vibration}%`;log(r,`Mestre ajustou a vibração de Robin para ${a.vibration}%.`);}
    else if(action==='vibrationDelta'){const a=getAnim(r,'Robin');a.vibration=Math.max(0,Math.min(100,a.vibration+(Number(value)||0)));a.status=`Vibração ${a.vibration}%`;log(r,`Mestre ajustou a vibração de Robin para ${a.vibration}%.`);}
    else if(action==='rollD20'){const n=crypto.randomInt(1,21);r.gege.d20=n;log(r,`Mestre rolou o D20 de Gege: ${n}.`);if(n===20){getAnim(r,'Gege Akutami').status='Saiu do palco';getAnim(r,'Gege Akutami').state='left_stage';}}
    else if(action==='gegeAgreement'){if(!['accepted','rejected'].includes(value))return;r.gege.agreement=value;r.gege.eventDone=true;const g=getAnim(r,'Gege Akutami');if(value==='rejected'){g.room='Área das Mesas';g.status='Triste — voltou ao palco após o evento';g.state='event_done';for(const a of r.animatronics){if(['Corredor Oeste','Corredor Leste','Cozinha','Entrada dos Banheiros'].includes(a.room))a.status='Agressivo pelo evento de Gege';}g.room='Palco';}else{g.room='Sala de Segurança';g.status='Interferindo nas portas';g.state='accepted';}log(r,`Acordo de Gege: ${value==='accepted'?'aceito':'recusado'}.`);}
    else if(action==='findMaomao'){r.maomao.found=true;getAnim(r,'Maomao').status='Encontrada';log(r,'Maomao foi encontrada.');}
    else if(action==='maomaoEnd'){if(r.energy<3)return fail(socket,'Energia insuficiente: são necessárias 3 unidades.');r.energy-=3;r.ended=true;r.winner='Mestre';log(r,'O Mestre usou a ação especial de Maomao: -3 energia e fim da partida.');}
    else if(action==='requestGetoReturn'){const g=getAnim(r,'Suguru Geto');if(!g.returnUnlocked)return fail(socket,'Geto ainda não chegou à Cleaning Room.');g.room=g.origin||'Palco';g.status='Retornando à origem';g.state='returning';log(r,'Geto recebeu ordem para retornar à sala de origem.');}
    else if(action==='setDoor'){if(value!=='left'&&value!=='right')return fail(socket,'Porta inválida.');r.doors[value]='closed';r.doors[value==='left'?'right':'left']='open';log(r,`Mestre alterou as portas: ${value==='left'?'esquerda':'direita'} fechada e a oposta aberta.`);}
    else if(action==='endMasterTurn'){if(!r.started||r.ended)return;if(!r.masterTurn)return fail(socket,'Ainda há turnos de jogadores pendentes.');autoRobin(r);log(r,'O turno do Mestre terminou. Robin recebeu +10% de vibração.');advanceRound(r);}
    else if(action==='newNight'){r.night++;r.ended=false;r.winner=null;r.energy=20;r.doors={left:'open',right:'open'};r.hour=r.config.nightStartHour;r.minute=0;for(const p of Object.values(r.players))p.alive=true;for(const a of r.animatronics){if(a.name==='Robin'){a.vibration=0;a.status='Vibração 0%';}if(a.name==='Satoru Gojo'){a.deactivatedUntilNight=0;a.status='Restrição ativa';}}r.gege={agreement:null,eventDone:false,d20:null};r.maomao.found=false;log(r,`Noite ${r.night} iniciada. Energia restaurada para 20/20; personagens revividos.`);r.turnQueue=Object.values(r.players).filter(p=>p.role==='player'&&p.connected).map(p=>p.id);r.currentTurn=r.turnQueue.shift()||null;r.masterTurn=!r.currentTurn;}
    else return fail(socket,'Ação desconhecida.');emitRoom(r);saveSnapshot();
  });
  socket.on('disconnect',()=>{const r=findRoom(socket);if(!r)return;const p=r.players[socket.id];if(p){p.connected=false;log(r,`${p.name} desconectou.`);if(r.currentTurn===socket.id){r.currentTurn=r.turnQueue.shift()||null;if(!r.currentTurn)r.masterTurn=true;}emitRoom(r);saveSnapshot();}});
});
function checkPresenceAttacks(room, player){for(const a of room.animatronics){if(a.room!==player.room||!['MalO','Vaporeon','Satoru Gojo'].includes(a.name))continue;if(a.name==='Satoru Gojo'&&a.status==='Restrição ativa')continue;const attack=crypto.randomInt(0,2)===1;if(attack){const dodge=crypto.randomInt(0,2)===1;if(!dodge){player.alive=false;log(room,`${player.name} foi eliminado por ${a.name}.`);}else log(room,`${player.name} desviou do ataque de ${a.name}.`);}else log(room,`${a.name} não atacou nesta oportunidade.`);}}
server.listen(PORT,()=>console.log(`RPG Terror Multiplayer disponível em http://localhost:${PORT}`));
