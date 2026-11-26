// Unit tests for the tactic detector and the coaching text behind explain(). The code lives
// inline in index.html, so this pulls that block out and runs it against known positions.
//   node tactics.cjs
const fs=require('fs'),path=require('path');
const {Chess}=require('../chess.js');
const VAL={p:1,n:3,b:3,r:5,q:9,k:0};let G=null;
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('// ---- tactics:'),html.indexOf('\nfunction list(){'));
eval(src+';globalThis.T={tacticOf,scanLine,tacticText,see,bmap,explain,coachMove,coachLines,themeSummary,moveIdea,ideaText,trapped,passerMotif,playLine,numLine,lineWins,THEMES,HABITS,setG:g=>{G=g}}');
let bad=0;
const say=(ok,name,extra)=>{if(!ok)bad++;console.log((ok?'ok   ':'BAD  ')+name+(extra?'\n       '+extra:''))};

// ---- 1. one-move tactics: [name, FEN, move, expected kind or null] ----
console.log('One-move tactics');
const cases=[
 ['knight fork','r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1','d5c7','fork'],
 ['pawn fork','4k3/8/2n1b3/8/2PP4/8/8/4K3 w - - 0 1','d4d5','fork'],
 ['pin to queen','r2qk2r/ppp2ppp/2np1n2/4p3/2B1P1b1/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 1','c1g5','pin'],
 ['pin to king','4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1','f1b5','pin'],
 ['skewer king queen','q7/8/8/k7/8/8/4K3/7R w - - 0 1','h1a1','skewer'],
 ['skewer queen rook','3r4/8/8/3q4/8/8/6B1/4K2k b - - 0 1','h1h2',null],
 ['bishop skewer queen rook','8/8/5r2/8/3q4/8/8/1RB1K2k w - - 0 1','c1b2','skewer'],
 ['discovered attack','4k3/4q3/8/8/4N3/8/8/4RK2 w - - 0 1','e4f6','disc'],
 ['discovered check','4k3/8/8/8/4B3/8/8/4RK2 w - - 0 1','e4c6','disc'],
 ['back rank','6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1','a1a8','backrank'],
 ['plain mate','7k/5Q2/6K1/8/8/8/8/8 w - - 0 1','f7g7','mate'],
 ['hanging piece','4k3/8/8/4n3/8/8/8/4RK2 w - - 0 1','e1e5','hang'],
 ['defended piece, no win','4k3/3p4/4n3/8/8/8/8/4RK2 w - - 0 1','e1e6',null],
 ['quiet move','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','e2e4',null],
 ['unsafe fork','r3k3/3q4/8/3N4/8/8/8/4K3 w - - 0 1','d5c7',null],
];
for(const [name,fen,uci,want] of cases){const t=T.tacticOf(fen,uci);const got=t?t.k:null;
 say(got===want,name+' -> '+got,t?'allowed: '+T.tacticText(t,true,true)+'\n       missed:  '+T.tacticText(t,false,false):'')}

// ---- 2. ideas that need a whole line: [name, FEN, engine line, expected kind or null, owed, owed square] ----
console.log('\nIdeas found in an engine line');
const lines=[
 ['removing the defender','6k1/1p3ppp/2n5/1B2b3/8/8/5PPP/4R1K1 w - - 0 1','b5c6 b7c6 e1e5','removal'],
 ['removing the defender, but the piece has a second defender','6k1/1p3ppp/2np4/1B2b3/8/8/5PPP/4R1K1 w - - 0 1','b5c6 b7c6 e1e5 d6e5',null],
 ['overloaded defender','6k1/3q1ppp/8/3n4/6b1/8/4BPPP/3R2K1 w - - 0 1','d1d5 d7d5 e2g4','overload'],
 ['overloaded defender, but a pawn also guards the second piece','6k1/3q1pp1/8/3n3p/6b1/8/4BPPP/3R2K1 w - - 0 1','d1d5 d7d5 e2g4 h5g4',null],
 ['deflection by a check','8/6k1/p5pp/3p2P1/7P/r2P1N2/6P1/1R4K1 w - - 0 39','b1b7 g7g8 g5h6','deflect'],
 ['check, but the king keeps defending','8/6k1/p5pp/3p2P1/7P/r2P1N2/6P1/1R4K1 w - - 0 39','b1b7 g7h7 g5h6 h7h6',null],
 ['trapped bishop','6k1/5pp1/7p/8/7B/6P1/5P1P/6K1 b - - 0 1','g7g5 h4g5 h6g5','trap'],
 ['attacked bishop with a way out','6k1/5pp1/7p/8/7B/8/5PPP/6K1 b - - 0 1','g7g5 h4g3 g8g7',null],
 ['pawn promotes in the line','8/8/P7/8/8/8/6k1/K7 w - - 0 1','a6a7 g2f3 a7a8q','promo'],
 ['promotion that is captured at once','1r6/P7/8/8/8/8/6k1/K7 w - - 0 1','a7a8q b8a8',null],
 ['mate at the end of the line','6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1','d1d8','backrank'],
 ['engine reports mate, line is cut short','6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1','g2g3',  'mate', 0, '', 3],
 // Opera game after 4...Bxf3: taking back the bishop is a trade, not a win
 ['recapture after a trade is not a hanging piece','rn1qkbnr/ppp2ppp/3p4/4P3/4P3/5b2/PPP2PPP/RNBQKB1R w KQkq - 0 5','d1f3 d6e5 f1c4',null,3,'f3'],
 // 1.e4 e5 2.Nf3 Nc6 3.d4 Nf6: dxe5 is answered by Nxe4, so the pawn is not simply won
 ['capture that is answered by a counter-capture','r1bqkb1r/pppp1ppp/2n2n2/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 4','d4e5 f6e4 f1c4','!hang'],
 // bishops are traded on b3: the rook takes back, it does not win a bishop
 ['second move takes back a trade','1b3rk1/r4p1p/p1nPb1p1/PpP4q/1P3P2/RB2B2P/3Q2P1/3R2K1 w - - 2 28','e3f2 e6b3 a3b3 f8e8',null],
];
for(const [name,fen,ucis,want,owed,osq,mating] of lines){const t=T.scanLine(fen,ucis.split(' '),mating||false,owed||0,osq||'');const got=t?t.k:null;
 const ok=want&&want[0]==='!'?got!==want.slice(1):got===want;
 say(ok,name+' -> '+got,t?'allowed: '+T.tacticText(t,true,true)+'\n       missed:  '+T.tacticText(t,false,true):'')}

// ---- 3. board helpers ----
console.log('\nBoard helpers');
say(T.trapped('6k1/5p2/7p/6p1/7B/6P1/5P1P/6K1 w - - 0 2','h4')===true,'trapped(): bishop on h4 has no safe square');
say(T.trapped('6k1/5p2/7p/6p1/7B/8/5PPP/6K1 w - - 0 2','h4')===false,'trapped(): bishop can step back to g3');
const pas=(fen,u)=>T.passerMotif(T.playLine(fen,[u]));
say(!!pas('4k3/8/8/3P4/8/8/8/4K3 w - - 0 1','d5d6'),'passerMotif(): passed pawn reaches the sixth rank');
say(!pas('4k3/4p3/8/3P4/8/8/8/4K3 w - - 0 1','d5d6'),'passerMotif(): not passed while an enemy pawn can take it');
say(!pas('4k3/8/8/8/3P4/8/8/4K3 w - - 0 1','d4d5'),'passerMotif(): the fifth rank is too early to mention');
const idea=(fen,u,prev)=>T.ideaText(T.moveIdea(fen,u,prev),'your','their');
const ideas=[
 ['rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2','g1f3','develops your knight'],
 ['r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4','e1g1','castles and gets your king to safety'],
 ['r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3','f1b5','develops your bishop'],
 ['rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2','b1c3','protects your pawn on e4'],
 ['rnbqkb1r/pppp1ppp/5n2/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3','d2d3','protects your pawn on e4'],
 ['r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4','b5a4','moves your attacked bishop to safety'],
 ['rnbqkbnr/pppp1ppp/4p3/8/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 2','d7d5','attacks their bishop on c4'],
 ['4k3/8/8/4n3/8/8/8/4RK2 w - - 0 1','e1e5','wins their knight on e5 with check'],
 ['7k/8/8/4n3/8/8/8/4RK2 w - - 0 1','e1e5','wins their knight on e5'],
 ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1','a1d1','puts your rook on the open d-file'],
 ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','e2e4','takes space in the center'],
 ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','a2a3',''],
];
for(const [fen,u,want] of ideas){const got=idea(fen,u);say(got===want,'moveIdea '+u+' -> "'+got+'"',got===want?'':'expected "'+want+'"')}

// ---- 4. the full lesson for one move: coachMove() on small real games ----
console.log('\nLessons from coachMove()');
// Build a game from SAN moves. The move under test is the last one. eB, eA: eval before and after
// it in centipawns from the mover's side. best, reply: engine lines (UCI) before and after it.
function game(sans,o){const ch=new Chess(o.fen||undefined);const g={me:'w',san:[],fens:[ch.fen()],vm:[],ucis:[],ev:[],best:[],pv:[],cls:[]};
 for(const s of sans){const m=ch.move(s);if(!m)throw new Error('bad test move '+s);g.san.push(m.san);g.vm.push(m);g.ucis.push(m.from+m.to+(m.promotion||''));g.fens.push(ch.fen())}
 const k=g.san.length,w=k%2===1,b=(o.best||'').split(' ').filter(Boolean),r=(o.reply||'').split(' ').filter(Boolean);
 g.me=o.opp?(w?'b':'w'):(w?'w':'b');g.ev[k-1]=w?o.eB:-o.eB;g.ev[k]=w?o.eA:-o.eA;g.best[k-1]=b[0]||g.ucis[k-1];g.pv[k-1]=b.join(' ');g.best[k]=r[0]||null;g.pv[k]=r.join(' ');g.cls[k]=o.cls||'mistake';
 return{g,k}}
const lessons=[
 // [name, moves, options, expected theme, text that must appear, text that must not appear]
 ['hanging piece: moved to an undefended square',['e4','e5','Nf3','Nc6','Bc4','Nd4','Nxe5','Qg5','Nxf7','Qxg2','Rf1','Qxe4+','Be2','Nf3#'].slice(0,3).concat(['Nf6','Ng5','h6','Nxf7','Kxf7','d4','Bd6']),{eB:300,eA:-100,best:'f8b4 c2c3',reply:'e4e5 d6e5 d4e5'},null,'',''],
 ['hanging piece: stopped defending it',['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','Nc3','d6','Bg5','O-O','Nd5','Be6','Nh4'],{eB:80,eA:-250,best:'g5f6 g7f6',reply:'e6d5 e4d5 f6d5',cls:'blunder'},null,'',''],
 ['missed recapture',['d4','d5','c4','dxc4','e3','b5','a4','c6','axb5','a6'],{eB:-60,eA:-220,best:'c6b5 b1c3',reply:'b5c6 b8c6'},'capture','did not take back on b5. cxb5 captures the pawn',''],
 ['recapture with another piece is not a missed recapture',['e4','e6','d4','d5','Bd3','Nc6','exd5','Qxd5'],{eB:-20,eA:-100,best:'e6d5 c2c3',reply:'g1f3 g8f6'},'!capture','','did not take back'],
 ['trade is not a hanging piece (Opera game, 4...Bxf3)',['e4','e5','Nf3','d6','d4','Bg4','dxe5','Bxf3'],{eB:-80,eA:-140,best:'b8d7 e5d6 f8d6',reply:'d1f3 d6e5 f1c4 d8f6',cls:'inaccuracy'},'!hang','','hanging'],
 ['discovered attack allowed (Legal trap, 4...g6)',['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6'],{eB:-50,eA:-240,best:'b8c6 h2h3',reply:'f3e5 d6e5 d1g4'},'tactic','discovered attack',''],
 ['forced mate allowed (Legal trap, 5...Bxd1)',['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6','Nxe5','Bxd1'],{eB:-220,eA:-9998,best:'d6e5 d1g4',reply:'c4f7 e8e7 c3d5',cls:'blunder'},'mate','checkmate in 2',''],
 ['missed mate',['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6','Nxe5','Bxd1','Nxd1'],{eB:9998,eA:300,best:'c4f7 e8e7 c3d5',reply:'d6e5'},'mate','missed a forced checkmate',''],
 ['line opened to your own king',['e4','e5','Nf3','f6'],{eB:-60,eA:-250,best:'b8c6 f1b5',reply:'f3e5 f6e5 d1h5 e8e7 h5e5 e7f7 f1c4 d7d5 c4d5 f7g6 h2h4 h7h5 d5b7 f8d6'},'king','opens a line to your own king',''],
 ['harmless pawn move with a later check elsewhere',['e4','e5','Nf3','a6'],{eB:-30,eA:-110,best:'b8c6 f1b5',reply:'f3e5 d8e7 d2d4 d7d6 e5f3 e7e4 f1e2',cls:'inaccuracy'},'!king','','own king'],
 ['king move that gives up castling',['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','Ke2'],{eB:30,eA:-90,best:'e1g1 d7d6',reply:'c6d4 f3d4 c5d4'},'king','gives up castling',''],
 ['same piece twice in the opening',['e4','e5','Nf3','Nc6','Ng1'],{eB:30,eA:-60,best:'f1b5 a7a6',reply:'g8f6 b1c3',cls:'inaccuracy'},'opening','moves the same knight again',''],
 ['queen out early',['e4','c5','Qh5'],{eB:40,eA:-30,best:'g1f3 b8c6',reply:'e7e6 h5e2',cls:'inaccuracy'},'opening','brings the queen out early',''],
 ['pawn move instead of development',['e4','e5','Nf3','Nc6','h3'],{eB:30,eA:-30,best:'f1c4 g8f6',reply:'g8f6 b1c3',cls:'inaccuracy'},'opening','pawn move does not help development',''],
 ['castling delayed',['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','Nc3','d6','h3'],{eB:30,eA:-40,best:'e1g1 e8g8',reply:'c6a5 c4b3',cls:'inaccuracy'},'opening','delays castling',''],
 ['developing move is not an opening slip',['e4','e5','Nf3','Nc6','Bc4'],{eB:30,eA:-40,best:'f1b5 a7a6',reply:'g8f6 d2d3',cls:'inaccuracy'},'!opening','',''],
 ['trading queens when behind',['Qxd8+'],{fen:'3q2k1/5ppp/2n5/8/8/8/5PPP/3Q2K1 w - - 0 1',eB:-350,eA:-450,best:'d1e2 d8d5',reply:'c6d8 g1f1'},'trade','trades queens while you are behind',''],
 ['trading queens with equal material is fine',['Qxd8+'],{fen:'3q2k1/5ppp/2n5/8/8/2N5/5PPP/3Q2K1 w - - 0 1',eB:0,eA:-70,best:'d1e2 d8d5',reply:'c6d8 g1f1',cls:'inaccuracy'},'!trade','','behind in material'],
 ['skipping a trade when ahead',['Qe2'],{fen:'3q1rk1/5ppp/8/8/8/2N5/5PPP/R2Q2K1 w - - 0 1',eB:420,eA:330,best:'d1d8 f8d8',reply:'d8d4 c3b5',cls:'inaccuracy'},'trade','Qxd8 would trade queens',''],
 ['skipping a trade with equal material is not a lesson about trades',['Qe2'],{fen:'3q1rk1/5ppp/8/8/8/8/5PPP/R2Q2K1 w - - 0 1',eB:40,eA:-30,best:'d1d8 f8d8',reply:'d8d4 a1b1',cls:'inaccuracy'},'!trade','',''],
 ['passed pawn allowed to advance',['h3'],{fen:'3r2k1/5ppp/8/8/3p4/8/5PPP/3R2K1 w - - 0 1',eB:-50,eA:-200,best:'d1d3 g8f8',reply:'d4d3 g1f1'},'pawn','passed pawn reach d3, two squares from promoting',''],
 ['pawn push that is not passed says nothing about passed pawns',['h3'],{fen:'3r2k1/5ppp/8/8/3p4/8/2P2PPP/3R2K1 w - - 0 1',eB:-50,eA:-200,best:'d1d3 g8f8',reply:'d4d3 c2d3'},'!pawn','','passed pawn'],
 ['promotion allowed',['Ka2'],{fen:'8/8/8/8/8/3p4/8/K5k1 w - - 0 1',eB:0,eA:-900,best:'a1b1 d3d2 b1c2',reply:'d3d2 a2b2 d2d1q',cls:'blunder'},'pawn','promotes in 2 moves',''],
 ['still winning',['Ka2'],{fen:'7k/8/8/8/8/8/1Q6/K1Q5 w - - 0 1',eB:2000,eA:1500,best:'c1c7 h8g8',reply:'h8g8 b2g2',cls:'inaccuracy'},'convert','still winning',''],
 ['stalemate',['Qf7'],{fen:'7k/8/6K1/8/8/8/8/5Q2 w - - 0 1',eB:9999,eA:0,best:'f1f8',reply:''},'convert','stalemate',''],
 ['honest fallback: best move and its idea',['e4','e6','Bc4'],{eB:40,eA:-30,best:'d2d4 d7d5',reply:'d7d5 e4d5 e6d5',cls:'inaccuracy'},'position','d5, which attacks your bishop on c4',''],
 ['honest fallback: nothing specific',['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d3','d6','O-O','O-O','Re1','a6','a4','Ba7','h3','h6','Nbd2','Re8','Nf1','Be6','Bb3'],{eB:20,eA:-40,best:'c4e6 e8e6',reply:'d6d5 e4d5',cls:'inaccuracy'},null,'',''],
];
// fill in the three cases that are easier to state as positions than as full games
lessons[0]=['hanging piece: moved to an undefended square',['Nd5'],{fen:'2b1kb1r/r4p2/p1qp2pp/1pp2P2/8/P1PPN3/1P2BPPP/R1B1K2R w KQk - 1 16',eB:-440,eA:-610,best:'e2f3 c6d7',reply:'c6d5 e1g1 a7e7',cls:'inaccuracy'},'hang','puts your knight on d5 where nothing defends it',''];
lessons[1]=['hanging piece: stopped defending it',['g4'],{fen:'1b2r1k1/r4p1p/p1nPb1p1/PpP4q/1P3P2/RB2B2P/3Q2P1/3R2K1 w - - 3 28',eB:180,eA:-120,best:'b3e6 e8e6',reply:'h5h3 b3e6 e8e6 d2g2',cls:'blunder'},'hang','stops defending your pawn on h3',''];
lessons.push(['hanging piece: attacked and left there',['Nc4'],{fen:'r1b1kb1r/1pq2pp1/p1np3p/2p1p2n/4P3/2PP1NQ1/PP1NBPPP/R1B1K2R w KQkq - 2 10',eB:-330,eA:-630,best:'g3h4 g7g6',reply:'h5g3 h2g3 f8e7',cls:'mistake'},'hang','was under attack and this does not save it','']);
for(const [name,sans,o,theme,must,mustNot] of lessons){let c=null,err='';try{const {g,k}=game(sans,o);c=T.coachMove(g,k);T.setG(g);if(c&&T.explain(k)!==c.what)err='explain() differs from coachMove().what'}catch(e){err=String(e)}
 let ok=!!c&&!err&&/[.]$/.test(c.what)&&!/undefined|null|NaN/.test(JSON.stringify(c));
 if(ok&&theme)ok=theme[0]==='!'?c.theme!==theme.slice(1):c.theme===theme;
 if(ok&&must)ok=c.what.includes(must);if(ok&&mustNot)ok=!c.what.includes(mustNot);
 if(ok&&c.mine)ok=!!c.habit;
 say(ok,name+' -> '+(c?c.theme:'no lesson'),err||(c?c.what+(c.reply.length?'\n       now: '+c.reply.join(' ')+(c.replyWhy?' ('+c.replyWhy+')':''):'')+(c.best.length?'\n       best: '+c.best.join(' ')+(c.bestWhy?' (it '+c.bestWhy+')':''):'')+'\n       habit: '+c.habit:''))}

// ---- 5. the same lesson told about the opponent, and the per-game summary ----
console.log('\nOpponent wording and summary');
{const {g,k}=game(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6'],{eB:-50,eA:-240,best:'b8c6 h2h3',reply:'f3e5 d6e5 d1g4',opp:true});const c=T.coachMove(g,k);
 say(c&&!c.mine&&/their bishop/.test(c.what)&&!/your bishop/.test(c.what),'opponent mistake is told as "their"',c&&c.what)}
{const {g,k}=game(['e4','e5','Nf3','d6','Bc4','Bg4','Nc3','g6','Nxe5','Bxd1'],{eB:-220,eA:-9998,best:'d6e5 d1g4',reply:'c4f7 e8e7 c3d5',cls:'blunder'});
 g.ev[7]=50;g.ev[8]=240;g.best[7]='b8c6';g.pv[7]='b8c6 h2h3';g.pv[8]='f3e5 d6e5 d1g4';g.best[8]='f3e5';g.cls[8]='mistake';
 const s=T.themeSummary(g);
 say(s.length===2&&s[0].theme==='mate'&&s[0].moves[0].k===10&&s[1].theme==='tactic'&&s[1].moves[0].k===8&&s[0].label===T.THEMES.mate[0],'themeSummary groups the two mistakes by theme, worst first',JSON.stringify(s.map(x=>[x.label,x.n,x.moves.map(m=>m.san)])));
 const cl=T.coachLines(g,10);say(cl.length>=3&&/^Opponent can now play: 6\. Bxf7\+ Ke7 7\. Nd5#/.test(cl[1])&&/^Habit: /.test(cl[cl.length-1]),'coachLines gives the lesson as plain text',cl.join('\n       '));
 g.me='w';say(T.themeSummary(g).length===0,'themeSummary only counts the player\'s own moves')}
say(T.numLine(8,['g6','Nxe5','Bxd1'])==='4... g6 5. Nxe5 Bxd1'&&T.numLine(9,['Nxe5','Bxd1'])==='5. Nxe5 Bxd1','numLine numbers moves from either side');
say(Object.keys(T.THEMES).every(k=>T.THEMES[k].length===3)&&!/\u2014/.test(JSON.stringify([T.THEMES,T.HABITS])),'every theme has a label, a habit and a practice tip');

console.log(bad?'\n'+bad+' unexpected':'\nAll tactic checks passed');process.exit(bad?1:0);
