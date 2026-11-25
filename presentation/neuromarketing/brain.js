const {chromium}=require('playwright');const fs=require('fs');
const d=JSON.parse(fs.readFileSync('theme.json','utf8')).icons.brain;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1000,height:1000}});
await p.setContent(`<body style="margin:0;background:transparent"><svg width="1000" height="1000" viewBox="0 0 120 120"><path d="${d}" fill="rgba(255,255,255,.02)" stroke="#6b6e78" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></body>`);
await p.screenshot({path:'brain_big.png',omitBackground:true});await b.close()})();
