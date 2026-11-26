// Unit tests for the tactic detector behind explain(). The code lives inline in
// index.html, so this pulls that block out and runs it against known positions.
//   node tactics.cjs
const fs=require('fs'),path=require('path');
const {Chess}=require('../chess.js');
const VAL={p:1,n:3,b:3,r:5,q:9,k:0};let G=null;
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const src=html.slice(html.indexOf('// ---- tactics:'),html.indexOf('\nfunction list(){'));
eval(src+';globalThis.T={tacticOf,scanLine,tacticText,see,bmap,explain}');
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
let bad=0;for(const [name,fen,uci,want] of cases){const t=T.tacticOf(fen,uci);const got=t?t.k:null;const ok=got===want;if(!ok)bad++;
 console.log((ok?'ok   ':'BAD  ')+name+' -> '+JSON.stringify(t)+(t?'\n       allowed: '+T.tacticText(t,true,true)+'\n       missed:  '+T.tacticText(t,false,false):''))}
console.log(bad?bad+' unexpected':'All tactic checks passed');process.exit(bad?1:0);
