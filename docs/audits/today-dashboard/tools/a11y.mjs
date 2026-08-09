import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 }).catch(()=>{});
await page.waitForTimeout(12000);
const data = await page.evaluate(() => {
  function parse(c){const m=c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);return m?[+m[1],+m[2],+m[3],m[4]===undefined?1:+m[4]]:null;}
  function lum([r,g,b]){const f=v=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)};const[R,G,B]=[f(r),f(g),f(b)];return 0.2126*R+0.7152*G+0.0722*B;}
  function contrast(fg,bg){const l1=lum(fg),l2=lum(bg);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  function bgOf(el){let n=el;while(n&&n!==document.documentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c&&c[3]>0.9)return c;n=n.parentElement;}return parse(getComputedStyle(document.body).backgroundColor)||[0,0,0,1];}
  const seen=new Map();
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  let node;
  while((node=walker.nextNode())){
    const t=node.textContent.trim(); if(!t||t.length<2)continue;
    const el=node.parentElement; if(!el)continue;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none')continue;
    const fg=parse(cs.color); if(!fg)continue;
    const bg=bgOf(el);
    const key=cs.color+'|'+cs.fontSize+'|'+cs.fontWeight+'|'+bg.join(',');
    if(!seen.has(key)) seen.set(key,{color:cs.color,fontSize:cs.fontSize,fontWeight:cs.fontWeight,bg:`rgb(${bg.slice(0,3).join(',')})`,ratio:+contrast(fg,bg).toFixed(2),sample:t.slice(0,42),count:0,font:cs.fontFamily.split(',')[0]});
    seen.get(key).count++;
  }
  const focusables=[...document.querySelectorAll('a,button,[tabindex],input,select')].length;
  const iconOnly=[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).length;
  const imgsNoAlt=[...document.querySelectorAll('svg')].filter(s=>!s.getAttribute('role')&&!s.getAttribute('aria-label')&&!s.closest('[aria-label]')).length;
  const headings=[...document.querySelectorAll('h1,h2,h3,h4')].map(h=>h.tagName+': '+h.textContent.trim().slice(0,40));
  return {styles:[...seen.values()].sort((a,b)=>a.ratio-b.ratio),focusables,iconOnlyButtonsNoLabel:iconOnly,svgNoAria:imgsNoAlt,headings};
});
console.log(JSON.stringify(data,null,1));
await browser.close();
