import initWasm, { Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import { resolveSocial } from "../_social.js";

let initialized;
const escapeXml=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function lines(value,max=37,count=4){
 const words=String(value||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().split(" ");
 const out=[];let line="";
 for(const word of words){if((line+" "+word).trim().length>max&&line){out.push(line);line=word;}else line=(line+" "+word).trim();if(out.length>=count)break;}
 if(out.length<count&&line)out.push(line);
 if(out.length===count&&words.join(" ").length>out.join(" ").length)out[count-1]=out[count-1].slice(0,max-2)+"…";
 return out;
}
const rows=(value,x,y,size=54,max=36,count=4,color="#fff")=>lines(value,max,count).map((t,i)=>'<text x="'+x+'" y="'+(y+i*size*1.19)+'" fill="'+color+'" font-size="'+size+'" font-weight="800">'+escapeXml(t)+'</text>').join("");
async function photoData(url){
 if(!/^https:\/\//i.test(url||""))return "";
 try{
  const parsed=new URL(url);
  if(parsed.username||parsed.password||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname))return "";
  const r=await fetch(url,{signal:AbortSignal.timeout(3500)});
  if(!r.ok)return "";
  const type=(r.headers.get("content-type")||"").split(";")[0];
  if(!["image/jpeg","image/png","image/webp"].includes(type))return "";
  if(Number(r.headers.get("content-length")||0)>3_000_000)return "";
  const buf=await r.arrayBuffer();if(buf.byteLength>3_000_000)return "";
  const bytes=new Uint8Array(buf);let str="";for(let i=0;i<bytes.length;i+=8192)str+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return "data:"+type+";base64,"+btoa(str);
 }catch{return "";}
}
async function fontData(){
 const url="https://raw.githubusercontent.com/google/fonts/main/ofl/onest/Onest%5Bwght%5D.ttf";
 const r=await fetch(url,{signal:AbortSignal.timeout(4000)});
 if(!r.ok)throw Error("font unavailable");
 return new Uint8Array(await r.arrayBuffer());
}
export async function onRequestGet({request,params,waitUntil}){
 const url=new URL(request.url);
 const parts=Array.isArray(params.path)?params.path:String(params.path||'').split('/');
 const kind=parts[0],id=parts[1],channel=parts[1],msgId=parts[2];
 if(kind!=="feed"&&kind!=="post")return new Response("Not found",{status:404});
 const cacheKey=new Request(request.url,{method:"GET"});
 const cached=await caches.default.match(cacheKey);if(cached)return cached;
 const data=await resolveSocial(request,kind,id,channel,msgId);
 if(!data)return new Response("Not found",{status:404});
 try{
  initialized ||= initWasm(wasm);
  await initialized;
  const [photo,font]=await Promise.all([photoData(data.image),fontData()]);
  const dark="#17171b",lime="#cbff2e";
  const picture=photo?'<defs><clipPath id="clip"><rect x="66" y="116" width="1068" height="350" rx="14"/></clipPath></defs><rect x="66" y="116" width="1068" height="350" rx="14" fill="#fff" stroke="'+dark+'" stroke-width="8"/><image x="66" y="116" width="1068" height="350" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)" href="'+photo+'"/>'+rows(data.title,72,520,37,48,1,dark):
   '<rect x="66" y="116" width="1068" height="350" rx="16" fill="'+dark+'"/>'+rows(data.title,96,210,55,34,4,"#ffffff");
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="'+lime+'"/><rect x="23" y="23" width="1154" height="584" rx="24" fill="none" stroke="'+dark+'" stroke-width="5"/><text x="66" y="85" fill="'+dark+'" font-size="29" font-weight="900">'+(kind==="feed"?"ПОЛИСТАЙ / ЛЕНТА":"ПОЛИСТАЙ / ПОСТ")+'</text>'+picture+'<path d="M66 555 H1134" stroke="'+dark+'" stroke-width="3"/><text x="66" y="592" font-size="26" font-weight="800" fill="'+dark+'">'+escapeXml((data.feed||"Полистай").slice(0,43))+'</text><text x="1132" y="592" text-anchor="end" font-size="24" font-weight="700" fill="'+dark+'">'+escapeXml(data.channel?"@"+data.channel:"polistay.online")+'</text></svg>';
  const png=new Resvg(svg,{fitTo:{mode:"width",value:1200},font:{fontBuffers:[font],loadSystemFonts:false,defaultFontFamily:"Onest"}}).render().asPng();
  const response=new Response(png,{headers:{"content-type":"image/png","cache-control":"public, max-age=300, s-maxage=1800","x-content-type-options":"nosniff"}});
  waitUntil(caches.default.put(cacheKey,response.clone()));
  return response;
 }catch(e){console.error("[social-card]",String(e));return new Response("Preview temporarily unavailable",{status:503,headers:{"cache-control":"no-store"}});}
}
