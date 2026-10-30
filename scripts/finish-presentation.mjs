import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve('docs/assets/demo');
const out=path.join(root,'final'); mkdirSync(out,{recursive:true});
const scenes=[
['ONE TRADE. EVERY REASON.','The trade is visible onchain.\nThe decision behind it usually is not.','entry-explorer.png'],
['A REAL DREAMDEX FILL','ETH-PERP short IOC / 0.004 ETH\nFilled at 2348.48 USDso / block 35175637','desktop-decision-trace.png'],
['SET THE CONDITION','Strategy Studio: deterministic BTC / ETH conditions.\nAn immutable saved version preserves the rule behind each decision.','desktop-strategy-studio.png'],
['AN EVENT STARTS THE DECISION','BTC OpenInterestUpdated is the controlled proof trigger.\nReal pool logs carry a block, transaction hash and log index.','desktop-live-pulse.png'],
['MARKET CONTEXT, THEN SAFETY','Fresh prices, account margin, precision and executable liquidity.\nMandatory safety checks apply after AND / OR condition evaluation.','desktop-markets.png'],
['UNSAFE MEANS NO SUBMISSION','Global pause, stale feeds, excess exposure and invalid grids block execution.\nHistorical blocked decisions remain inspectable in Decision Trace.','desktop-settings.png'],
['ONE AUTHORIZED EXECUTION','A singleton lease and durable unique intent fence the submission.\nThe linked bot submits through DreamDEX placeOrderFor.','desktop-overview.png'],
['RECEIPT. ORDER. RECONCILIATION.','Order 16472942457822639999900 was reconciled as filled.\nA successful receipt alone is never treated as proof of a fill.','desktop-decision-trace.png'],
['PROTECTION WITH CLEAR AUTHORITY','The later close was owner-managed through DreamDEX, not THRYNT.\nOwner-held reduce-only TP/SL requires the owner wallet; the account is flat.','desktop-positions-and-risk.png'],
['THRYNT','Set the condition. Prove the execution.\nthrynt.vercel.app / Somnia Hideki / chain 50383','desktop-overview.png']
];
const run=(a)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...a],{stdio:'inherit'});
function segment(i,duration,prefix){
 const [title,caption,img]=scenes[i]; const stem=`${prefix}-${i}`;
 writeFileSync(path.join(out,stem+'-title.txt'),title);writeFileSync(path.join(out,stem+'-caption.txt'),caption);
 const filter=`crop=iw:min(ih\\,700):0:0,scale=1120:490:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:100:color=0x080f17,drawbox=x=0:y=0:w=1280:h=96:color=0x080f17:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':textfile='${stem}-title.txt':fontsize=34:fontcolor=0x50e0c5:x=80:y=32,drawbox=x=0:y=600:w=1280:h=120:color=0x080f17:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile='${stem}-caption.txt':fontsize=23:line_spacing=12:fontcolor=white:x=80:y=622,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='HISTORICAL EVIDENCE / PRODUCTION CAPTURE - 30 OCT 2026':fontsize=13:fontcolor=0x9bb2c5:x=80:y=578,fade=t=in:st=0:d=0.35,fade=t=out:st=${duration-.35}:d=0.35`;
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-loop','1','-i',path.join(root,img),'-t',String(duration),'-vf',filter,'-r','24','-c:v','libx264','-preset','ultrafast','-crf','21','-pix_fmt','yuv420p',stem+'.mp4'],{cwd:out,stdio:'inherit'});return stem+'.mp4';
}
for(const [prefix,indices,duration] of [['main',scenes.map((_,i)=>i),15],['social',[0,2,5,7,9],8]]){
 const files=indices.map(i=>segment(i,duration,prefix));writeFileSync(path.join(out,prefix+'.txt'),files.map(f=>`file '${f}'`).join('\n'));
 run(['-f','concat','-safe','0','-i',path.join(out,prefix+'.txt'),'-c','copy','-movflags','+faststart',path.join(out,`THRYNT-${prefix}-final.mp4`)]);
}
run(['-ss','3','-i',path.join(out,'THRYNT-main-final.mp4'),'-frames:v','1',path.join(out,'THRYNT-cover.png')]);
console.log(out);
