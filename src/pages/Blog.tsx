import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase.ts";
import { invokeFn } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import "./Blog.css";

type Block = { type: "paragraph" | "heading" | "image" | "video" | "file" | "quote"; text?: string; url?: string; caption?: string; level?: number };
type Article = { id: number; slug: string; title: string; excerpt: string; cover_url: string | null; tags: string[]; blocks: Block[]; seo_title: string | null; seo_description: string | null; status: "draft" | "published"; published_at: string | null; created_at: string };
const blank = (): Omit<Article,"id"|"created_at"> => ({ slug:"",title:"",excerpt:"",cover_url:null,tags:[],blocks:[{type:"paragraph",text:""}],seo_title:null,seo_description:null,status:"draft",published_at:null });
function meta(title: string, desc: string, canonical: string) {
 document.title=title;
 const set=(key:string,value:string)=>{let node=document.querySelector<HTMLMetaElement>(`meta[name="${key}"]`);if(!node){node=document.createElement("meta");node.name=key;document.head.append(node)}node.content=value};
 set("description",desc);
 let link=document.querySelector<HTMLLinkElement>('link[rel="canonical"]');if(!link){link=document.createElement("link");link.rel="canonical";document.head.append(link)}link.href=canonical;
}
function RichBlock({block}: {block:Block}) {
 if(block.type==="heading"){return block.level===3?<h3>{block.text}</h3>:<h2>{block.text}</h2>}
 if(block.type==="quote")return <blockquote>{block.text}</blockquote>;
 if(block.type==="image")return <figure>{block.url&&<img src={block.url} alt={block.caption||""} loading="lazy" />}<figcaption>{block.caption}</figcaption></figure>;
 if(block.type==="file")return <p className="blog-attachment"><a href={block.url} target="_blank" rel="noopener noreferrer" download>↓ {block.caption||"Скачать файл"}</a></p>;
 if(block.type==="video"){const url=block.url||"";const youtube=/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/.exec(url);return <figure>{youtube?<iframe title={block.caption||"Видео"} src={`https://www.youtube-nocookie.com/embed/${youtube[1]}`} loading="lazy" allowFullScreen/>:<video controls src={url}/>}<figcaption>{block.caption}</figcaption></figure>}
 return <p>{(block.text||"").split(/(https?:\/\/[^\s]+)/g).map((chunk,i)=>/^https?:\/\//.test(chunk)?<a key={i} href={chunk} target="_blank" rel="noopener noreferrer">{chunk}</a>:chunk)}</p>;
}
export function BlogIndex(){
 const [posts,setPosts]=useState<Article[]>([]),[error,setError]=useState(""),[tag,setTag]=useState("");
 const {isAdmin}=useAuth();
 useEffect(()=>{meta("Блог Полистай — статьи о Telegram-каналах и цифровой культуре","Статьи, исследования и новости проекта Полистай.","https://polistay.online/blog");supabase().from("blog_posts").select("*").eq("status","published").order("published_at",{ascending:false}).then(({data,error})=>{if(error)setError("Блог пока недоступен.");else setPosts(data||[])});},[]);
 const tags=useMemo(()=>[...new Set(posts.flatMap(p=>p.tags||[]))], [posts]);
 return <main className="project-blog"><header className="blog-hero"><span>ПОЛИСТАЙ / ЖУРНАЛ</span><h1>Мысли, находки<br/>и хороший интернет.</h1><p>Блог проекта о Telegram-каналах, цифровой культуре и том, что мы читаем.</p>{isAdmin&&<Link className="blog-action" to="/blog/editor">+ Новая статья</Link>}</header><section className="blog-body"><div className="blog-filter"><button className={!tag?"active":""} onClick={()=>setTag("")}>Все статьи</button>{tags.map(t=><button key={t} className={tag===t?"active":""} onClick={()=>setTag(t)}>#{t}</button>)}</div>{error&&<p role="alert">{error}</p>}<div className="blog-grid">{posts.filter(p=>!tag||p.tags.includes(tag)).map(p=><Link className="blog-card" key={p.id} to={`/blog/${p.slug}`}>{p.cover_url&&<img src={p.cover_url} alt="" loading="lazy"/>}<div><small>{p.published_at&&new Date(p.published_at).toLocaleDateString("ru-RU")} · {(p.tags||[]).join(" / ")}</small><h2>{p.title}</h2><p>{p.excerpt}</p><b>Читать статью ↗</b></div></Link>)}</div>{!error&&!posts.length&&<p>Пока нет опубликованных статей.</p>}</section></main>;
}
export function BlogArticle(){
 const {slug}=useParams(),[post,setPost]=useState<Article|null>(null),[error,setError]=useState("");
 const {isAdmin}=useAuth();
 useEffect(()=>{supabase().from("blog_posts").select("*").eq("slug",slug).maybeSingle().then(({data,error})=>{if(error||!data){setError("Статья не найдена.");return}setPost(data);meta(data.seo_title||data.title+" — Блог Полистай",data.seo_description||data.excerpt,`https://polistay.online/blog/${data.slug}`);});},[slug]);
 return <main className="project-blog blog-article"><Link to="/blog">← Все статьи</Link>{error?<p role="alert">{error}</p>:post?<article><header><small>{post.published_at&&new Date(post.published_at).toLocaleDateString("ru-RU")} · {(post.tags||[]).join(" / ")}</small><h1>{post.title}</h1><p>{post.excerpt}</p>{isAdmin&&<Link to={`/blog/editor/${post.slug}`}>Редактировать ↗</Link>}</header>{post.cover_url&&<img className="blog-main-cover" src={post.cover_url} alt="" />}<div className="blog-prose">{(post.blocks||[]).map((block,i)=><RichBlock key={i} block={block}/>)}</div></article>:<p>Загружаем статью…</p>}</main>;
}
export function BlogEditor(){
 const {isAdmin}=useAuth(),{slug}=useParams(),nav=useNavigate();
 const [post,setPost]=useState<Omit<Article,"id"|"created_at">>(blank()),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[uploading,setUploading]=useState(false);
 useEffect(()=>{if(!slug)return;supabase().from("blog_posts").select("*").eq("slug",slug).maybeSingle().then(({data,error})=>{if(error)setMessage(error.message);else if(data)setPost(data)});},[slug]);
 if(!isAdmin)return <main className="project-blog"><h1>Доступ только администратору Полистай</h1></main>;
 const change=(k:keyof typeof post,v:unknown)=>setPost(p=>({...p,[k]:v}));
 const updateBlock=(i:number,k:keyof Block,v:unknown)=>setPost(p=>({...p,blocks:p.blocks.map((b,n)=>n===i?{...b,[k]:v}:b)}));
 async function upload(file:File, onUrl:(url:string)=>void){
  const max=50*1024*1024;
  if(file.size>max){setMessage("Файл слишком большой. Максимум 50 МБ.");return}
  const ext=(file.name.split(".").pop()||"bin").toLowerCase().replace(/[^a-z0-9]/g,"");
  const kind=file.type.startsWith("image/")?"images":file.type.startsWith("video/")?"videos":"files";
  const path=kind+"/"+crypto.randomUUID()+"."+ext;
  setUploading(true);setMessage("");
  try{
   const {error}=await supabase().storage.from("blog-media").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});
   if(error)throw error;
   const {data}=supabase().storage.from("blog-media").getPublicUrl(path);
   onUrl(data.publicUrl);
  }catch(e){setMessage("Не удалось загрузить файл: "+(e as Error).message)}
  finally{setUploading(false)}
 }
 async function save(status:"draft"|"published"){
  if(!post.title.trim()||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)){setMessage("Заполни название и slug латиницей через дефисы.");return}
  setBusy(true);setMessage("");
  const payload={...post,status,published_at:status==="published"?(post.published_at||new Date().toISOString()):post.published_at};
  const query=slug?supabase().from("blog_posts").update(payload).eq("slug",slug):supabase().from("blog_posts").insert(payload);
  const {error}=await query;
  setBusy(false);
  if(error){setMessage(error.message);return}
  if(status==="published"){
   try{await invokeFn("blog-deploy",{slug:post.slug},20000);setMessage("Статья опубликована. SEO-сборка запущена.");}
   catch(e){setMessage("Статья опубликована, но SEO-сборка не запущена: "+(e as Error).message);}
   return;
  }
  nav("/blog/editor/"+post.slug);
 }
 return <main className="project-blog blog-editor"><Link to="/blog">← Блог</Link><h1>{slug?"Редактировать статью":"Новая статья"}</h1><label>Заголовок<input value={post.title} onChange={e=>change("title",e.target.value)}/></label><label>Адрес (slug)<input value={post.slug} onChange={e=>change("slug",e.target.value.toLowerCase())} placeholder="primer-stati"/></label><label>Анонс<textarea value={post.excerpt} onChange={e=>change("excerpt",e.target.value)}/></label><label>URL обложки<input value={post.cover_url||""} onChange={e=>change("cover_url",e.target.value)}/></label><label>Или загрузить обложку с компьютера<input type="file" accept="image/*" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,url=>change("cover_url",url));e.target.value=""}} /></label><label>Теги через запятую<input value={post.tags.join(", ")} onChange={e=>change("tags",e.target.value.split(",").map(s=>s.trim()).filter(Boolean))}/></label><h2>Материал</h2>{post.blocks.map((b,i)=><div className="blog-edit-block" key={i}><div><select value={b.type} onChange={e=>updateBlock(i,"type",e.target.value)}><option value="paragraph">Текст</option><option value="heading">Заголовок</option><option value="quote">Цитата</option><option value="image">Изображение</option><option value="video">Видео</option><option value="file">Файл для скачивания</option></select><button onClick={()=>change("blocks",post.blocks.filter((_,n)=>n!==i))}>Удалить</button><button disabled={i===0} onClick={()=>{const a=[...post.blocks];[a[i-1],a[i]]=[a[i],a[i-1]];change("blocks",a)}}>↑</button><button disabled={i===post.blocks.length-1} onClick={()=>{const a=[...post.blocks];[a[i+1],a[i]]=[a[i],a[i+1]];change("blocks",a)}}>↓</button></div>{b.type==="image"||b.type==="video"||b.type==="file"?<><input placeholder="URL медиа" value={b.url||""} onChange={e=>updateBlock(i,"url",e.target.value)}/><label>Загрузить с компьютера<input type="file" accept={b.type==="image"?"image/*":b.type==="video"?"video/*":undefined} disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,url=>{updateBlock(i,"url",url);if(b.type==="file")updateBlock(i,"caption",file.name)});e.target.value=""}} /></label><input placeholder={b.type==="image"?"Подпись / alt-текст":b.type==="file"?"Название файла":"Подпись к видео"} value={b.caption||""} onChange={e=>updateBlock(i,"caption",e.target.value)}/></>:<textarea rows={b.type==="paragraph"?7:3} value={b.text||""} onChange={e=>updateBlock(i,"text",e.target.value)}/>}</div>)}<button className="blog-action" onClick={()=>change("blocks",[...post.blocks,{type:"paragraph",text:""}])}>+ Добавить блок</button><h2>SEO</h2><label>SEO title<input value={post.seo_title||""} onChange={e=>change("seo_title",e.target.value)}/></label><label>SEO description<textarea value={post.seo_description||""} onChange={e=>change("seo_description",e.target.value)}/></label><div className="blog-save"><button disabled={busy||uploading} onClick={()=>save("draft")}>Сохранить черновик</button><button disabled={busy||uploading} onClick={()=>save("published")}>Опубликовать</button></div>{uploading&&<p role="status">Загружаем файл…</p>}{message&&<p role="alert">{message}</p>}</main>;
}
