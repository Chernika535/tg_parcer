// Branded 1200×630 PNG previews for social crawlers. Build-time only.
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const root=resolve(process.cwd(),"dist");
const ink="#17171b", lime="#cbff2e";
const esc=(v)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
let fonts=[];
export async function initCards(){
 try {
  const response=await fetch("https://raw.githubusercontent.com/google/fonts/main/ofl/onest/Onest%5Bwght%5D.ttf",{signal:AbortSignal.timeout(10000)});
  if(response.ok)fonts=[Buffer.from(await response.arrayBuffer())];
 }catch(e){console.warn("[og] font download:",e.message);}
}
const words=(s,max=36,maxLines=4)=>{
 const tokens=String(s||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().split(" ");
 const lines=[];let line="";
 for(const word of tokens){if((line+" "+word).trim().length>max&&line){lines.push(line);line=word;}else line=(line+" "+word).trim();if(lines.length>=maxLines)break;}
 if(lines.length<maxLines&&line)lines.push(line);
 if(lines.length===maxLines&&tokens.join(" ").length>lines.join(" ").length)lines[maxLines-1]=lines[maxLines-1].replace(/[\s.,;:!?-]+$/,"").slice(0,max-3)+"…";
 return lines;
};
const textLines=(value,x,y,opts={})=>{
 const {size=54,lineHeight=1.15,max=34,lines=4,color=ink,weight=800}=opts;
 return words(value,max,lines).map((t,i)=>'<text x="'+x+'" y="'+(y+i*size*lineHeight)+'" fill="'+color+'" font-size="'+size+'" font-weight="'+weight+'">'+esc(t)+'</text>').join("");
};
async function dataImage(url){
 if(!/^https:\/\//i.test(url||""))return "";
 try {
  const r=await fetch(url,{signal:AbortSignal.timeout(7000),headers:{"User-Agent":"PolistaySocialPreview/1.0"}});
  if(!r.ok)return "";
  const type=r.headers.get("content-type")?.split(";")[0]||"";
  if(!["image/png","image/jpeg","image/webp"].includes(type))return "";
  const buf=Buffer.from(await r.arrayBuffer());
  if(buf.length>4_000_000)return "";
  return "data:"+type+";base64,"+buf.toString("base64");
 }catch{return "";}
}
export async function makeCard(rel,{kind="post",title="",feed="",channel="",image=""}={}){
 const photo=await dataImage(image);
 const label=kind==="feed"?"ПОЛИСТАЙ / ЛЕНТА":"ПОЛИСТАЙ / ПОСТ";
 const mainTitle=String(title||"Полистай").trim();
 const isPhoto=!!photo;
 const svg='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">'+
 '<rect width="1200" height="630" fill="'+lime+'"/>'+
 '<rect x="22" y="22" width="1156" height="586" rx="22" fill="none" stroke="'+ink+'" stroke-width="5"/>'+
 '<text x="65" y="85" fill="'+ink+'" font-size="29" font-weight="900" letter-spacing="2">'+label+'</text>'+
 '<text x="1092" y="85" fill="'+ink+'" font-size="52" font-weight="900">↗</text>'+
 (isPhoto?
  '<defs><clipPath id="photo"><rect x="65" y="114" width="1070" height="353" rx="16"/></clipPath></defs>'+
  '<rect x="75" y="124" width="1060" height="353" rx="16" fill="'+ink+'"/>'+
  '<rect x="65" y="114" width="1070" height="353" rx="16" fill="#fff" stroke="'+ink+'" stroke-width="7"/>'+
  '<image x="65" y="114" width="1070" height="353" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo)" href="'+photo+'"/>'+
  textLines(mainTitle,72,526,{size:37,max:48,lines:1}):
  '<rect x="65" y="114" width="1070" height="353" rx="16" fill="'+ink+'"/>'+
  textLines(mainTitle,96,215,{size:57,max:33,lines:4,color:"#ffffff"}))+
 '<rect x="65" y="554" width="1070" height="3" fill="'+ink+'"/>'+
 '<text x="65" y="592" fill="'+ink+'" font-size="27" font-weight="800">'+esc(String(feed||"Лента Полистай").slice(0,43))+'</text>'+
 '<text x="1132" y="592" text-anchor="end" fill="'+ink+'" font-size="25" font-weight="700">'+esc(channel?("@"+String(channel).replace(/^@/,"").slice(0,31)):"polistay.online")+'</text>'+
 '</svg>';
 try{
  const renderer=new Resvg(svg,{fitTo:{mode:"width",value:1200},font:{fontBuffers:fonts,loadSystemFonts:true,defaultFontFamily:"Onest"}});
  const full=resolve(root,rel);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,renderer.render().asPng());return true;
 }catch(e){console.warn("[og] card failed:",rel,e.message);return false;}
}
