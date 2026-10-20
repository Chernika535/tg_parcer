// Cloudflare Pages Functions: social metadata resolved at request time.
const SITE="https://polistay.online";
const BASE="https://kklxahjnptrgnwcrpauh.supabase.co";
const esc=(s)=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const ch=(s)=>String(s??"").toLowerCase().replace(/^@/,"").replace(/[^a-z0-9_]/g,"");
const validId=(s)=>/^\d{1,12}$/.test(String(s));
async function getFeeds(){try{const r=await fetch(BASE+"/functions/v1/feeds?action=public",{signal:AbortSignal.timeout(3500)});const j=await r.json();return Array.isArray(j.feeds)?j.feeds:[];}catch{return [];}}
async function getPosts(channel){try{const r=await fetch(BASE+"/functions/v1/read-channels?channels="+encodeURIComponent(channel),{signal:AbortSignal.timeout(5000)});const j=await r.json();return Array.isArray(j.posts)?j.posts:[];}catch{return [];}}
function html({title,desc,img,url}){
 const tags='<title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta property="og:type" content="article"><meta property="og:site_name" content="Полистай"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:url" content="'+esc(url)+'"><meta property="og:image" content="'+esc(img)+'"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="'+esc(img)+'">';
 return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+tags+'</head><body><main><h1>'+esc(title)+'</h1><p>'+esc(desc)+'</p><p><a href="'+esc(url)+'">Открыть в Полистай</a></p></main><script>location.replace('+JSON.stringify(url)+')</script></body></html>';
}
export async function socialPage(request,kind,id,channel,msgId){
 const u=new URL(request.url);
 const feeds=await getFeeds();
 let title="",desc="",image="",url="";
 if(kind==="feed"){
  const f=feeds.find(x=>String(x.id)===String(id)&&!x.adult);
  if(!f)return null;
  title=f.title||"Лента Полистай";desc=f.description||"Подборка Telegram-каналов";
  image=f.cover_url||"";url=SITE+"/feed/"+id;
 }else{
  const name=ch(channel);
  const preferred=validId(u.searchParams.get("feed"))?feeds.find(f=>String(f.id)===u.searchParams.get("feed")&&!f.adult&&(f.channels||[]).some(c=>ch(c)===name)):null;
  const source=preferred||feeds.find(f=>!f.adult&&(f.channels||[]).some(c=>ch(c)===name));
  if(!source||!validId(msgId)||!name)return null;
  const posts=await getPosts(name);
  const p=posts.find(p=>Number(p.msgId)===Number(msgId));
  if(!p)return null;
  const text=String(p.text||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
  title=(text||"Публикация "+(p.channelTitle||"@"+name)).slice(0,120);
  desc=source.title+" · @"+name;
  image=p.media?.find(m=>m.type==="photo"&&/^https:\/\//.test(m.url||""))?.url||"";
  url=SITE+"/post/"+name+"/"+msgId+(preferred?"?feed="+preferred.id:"");
 }
 const og=SITE+"/og-cover.png";
 const response=new Response(html({title,desc,img:image||og,url}),{headers:{"content-type":"text/html; charset=utf-8","cache-control":"public, max-age=60, s-maxage=300"}});
 return response;
}
