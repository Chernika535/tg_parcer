import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase.ts";
import { invokeFn } from "../lib/data.ts";
import { useAuth } from "../lib/auth.tsx";
import "./Blog.css";
import BlogWritingEditor from "../components/BlogWritingEditor.tsx";

type Block = { type: "paragraph" | "heading" | "image" | "video" | "file" | "quote"; text?: string; url?: string; caption?: string; level?: number };
type Section = { id:number; slug:string; title:string; description:string; seo_title:string|null; seo_description:string|null; sort_order:number };
type Article = { section_id?:number|null; content_html?:string|null; id: number; slug: string; title: string; excerpt: string; cover_url: string | null; tags: string[]; blocks: Block[]; seo_title: string | null; seo_description: string | null; status: "draft" | "published"; published_at: string | null; created_at: string };
const blank = (): Omit<Article,"id"|"created_at"> => ({ slug:"",title:"",excerpt:"",cover_url:null,tags:[],section_id:null,content_html:"",blocks:[{type:"paragraph",text:""}],seo_title:null,seo_description:null,status:"draft",published_at:null });
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
 const [sections,setSections]=useState<Section[]>([]),[activeSection,setActiveSection]=useState<number|null>(null);
 useEffect(()=>{supabase().from("blog_sections").select("*").order("sort_order").then(({data})=>setSections(data||[]));},[]);
 useEffect(()=>{meta("Блог Полистай — статьи о Telegram-каналах и цифровой культуре","Статьи, исследования и новости проекта Полистай.","https://polistay.online/blog");supabase().from("blog_posts").select("*").eq("status","published").order("published_at",{ascending:false}).then(({data,error})=>{if(error)setError("Блог пока недоступен.");else setPosts(data||[])});},[]);
 const tags=useMemo(()=>[...new Set(posts.flatMap(p=>p.tags||[]))], [posts]);
 return <main className="project-blog"><header className="blog-hero"><span>ПОЛИСТАЙ / ЖУРНАЛ</span><h1>Мысли, находки<br/>и хороший интернет.</h1><p>Блог проекта о Telegram-каналах, цифровой культуре и том, что мы читаем.</p>{isAdmin&&<Link className="blog-action" to="/blog/editor">+ Новая статья</Link>}</header><section className="blog-body"><div className="blog-filter"><button className={activeSection===null?"active":""} onClick={()=>setActiveSection(null)}>Все разделы</button>{sections.map(sec=><button key={sec.id} className={activeSection===sec.id?"active":""} onClick={()=>setActiveSection(sec.id)}>{sec.title}</button>)}</div><div className="blog-filter"><button className={!tag?"active":""} onClick={()=>setTag("")}>Все теги</button>{tags.map(t=><button key={t} className={tag===t?"active":""} onClick={()=>setTag(t)}>#{t}</button>)}</div>{error&&<p role="alert">{error}</p>}<div className="blog-grid">{posts.filter(p=>(activeSection===null||p.section_id===activeSection)&&(!tag||p.tags.includes(tag))).map(p=><Link className="blog-card" key={p.id} to={`/blog/${p.slug}`}>{p.cover_url&&<img src={p.cover_url} alt="" loading="lazy"/>}<div><small>{sections.find(s=>s.id===p.section_id)?.title||"Общее"} · {p.published_at&&new Date(p.published_at).toLocaleDateString("ru-RU")} · {(p.tags||[]).join(" / ")}</small><h2>{p.title}</h2><p>{p.excerpt}</p><b>Читать статью ↗</b></div></Link>)}</div>{!error&&!posts.length&&<p>Пока нет опубликованных статей.</p>}</section></main>;
}
export function BlogArticle(){
 const {slug}=useParams(),[post,setPost]=useState<Article|null>(null),[error,setError]=useState("");
 const {isAdmin}=useAuth();
 const [section,setSection]=useState<Section|null>(null);
 useEffect(()=>{supabase().from("blog_posts").select("*").eq("slug",slug).maybeSingle().then(({data,error})=>{if(error||!data){setError("Статья не найдена.");return}setPost(data);if(data.section_id)supabase().from("blog_sections").select("*").eq("id",data.section_id).maybeSingle().then(({data:s})=>setSection(s));meta(data.seo_title||data.title+" — Блог Полистай",data.seo_description||data.excerpt,`https://polistay.online/blog/${data.slug}`);});},[slug]);
 return <main className="project-blog blog-article"><Link to="/blog">← Все статьи</Link>{error?<p role="alert">{error}</p>:post?<article><header><small><Link to="/blog">Блог</Link> / {section?.title||"Общее"} · {post.published_at&&new Date(post.published_at).toLocaleDateString("ru-RU")} · {(post.tags||[]).join(" / ")}</small><h1>{post.title}</h1><p>{post.excerpt}</p>{isAdmin&&<Link to={`/blog/editor/${post.slug}`}>Редактировать ↗</Link>}</header>{post.cover_url&&<img className="blog-main-cover" src={post.cover_url} alt="" />}<div className="blog-prose">{post.content_html?<div className="blog-article-html" dangerouslySetInnerHTML={{__html:post.content_html}}/>:(post.blocks||[]).map((block,i)=><RichBlock key={i} block={block}/>)}</div></article>:<p>Загружаем статью…</p>}</main>;
}
export function BlogEditor(){
 const {isAdmin}=useAuth(),{slug}=useParams(),nav=useNavigate();
 const [sections,setSections]=useState<Section[]>([]);
 useEffect(()=>{supabase().from("blog_sections").select("*").order("sort_order").then(({data})=>setSections(data||[]));},[]);
 const [post,setPost]=useState<Omit<Article,"id"|"created_at">>(blank()),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[uploading,setUploading]=useState(false),[deploying,setDeploying]=useState(false);
 useEffect(()=>{if(!slug)return;supabase().from("blog_posts").select("*").eq("slug",slug).maybeSingle().then(({data,error})=>{if(error)setMessage(error.message);else if(data)setPost(data)});},[slug]);
 if(!isAdmin)return <main className="project-blog"><h1>Доступ только администратору Полистай</h1></main>;
 const change=(k:keyof typeof post,v:unknown)=>setPost(p=>({...p,[k]:v}));

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
 async function deploy(){
  if(!window.confirm("Создать коммит в GitHub и запустить SEO-сборку всех опубликованных статей?"))return;
  setDeploying(true);setMessage("");
  try{const result=await invokeFn("blog-deploy",{},25000) as {queued?:boolean;sha?:string;error?:string};if(!result.queued)throw new Error(result.error||"GitHub не подтвердил создание коммита");setMessage("Коммит создан ("+(result.sha?.slice(0,7)||"GitHub")+"). Cloudflare Pages должен начать сборку.");}
  catch(e){setMessage("SEO-деплой не запущен: "+(e as Error).message)}
  finally{setDeploying(false)}
 }
 async function save(status:"draft"|"published"){
  if(!post.title.trim()||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)){setMessage("Заполни название и slug латиницей через дефисы.");return}
  setBusy(true);setMessage("");
  const {id: _id, created_at: _createdAt, ...editablePost} = post as Article;
  const payload={...editablePost,section_id:post.section_id||sections[0]?.id||null,status,published_at:status==="published"?(post.published_at||new Date().toISOString()):post.published_at};
  const query=slug?supabase().from("blog_posts").update(payload).eq("slug",slug):supabase().from("blog_posts").insert(payload);
  const {error}=await query;
  setBusy(false);
  if(error){setMessage(error.message);return}
  if(status==="published"){setMessage("Статья опубликована. Когда закончишь добавлять статьи, нажми «Запустить SEO-деплой».");return;}
  nav("/blog/editor/"+post.slug);
 }
 return <main className="project-blog blog-editor"><Link to="/blog">← Блог</Link><h1>{slug?"Редактировать статью":"Новая статья"}</h1><label>Заголовок<input value={post.title} onChange={e=>change("title",e.target.value)}/></label><label>Адрес (slug)<input value={post.slug} onChange={e=>change("slug",e.target.value.toLowerCase())} placeholder="primer-stati"/></label><label>Анонс<textarea value={post.excerpt} onChange={e=>change("excerpt",e.target.value)}/></label><label>URL обложки<input value={post.cover_url||""} onChange={e=>change("cover_url",e.target.value)}/></label><label>Или загрузить обложку с компьютера<input type="file" accept="image/*" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file,url=>change("cover_url",url));e.target.value=""}} /></label><label>Теги через запятую<input value={post.tags.join(", ")} onChange={e=>change("tags",e.target.value.split(",").map(s=>s.trim()).filter(Boolean))}/></label><h2>Материал</h2><BlogWritingEditor key={slug||"new"} value={post.content_html||((post.blocks||[]).map(b=>b.type==="heading"?"<h2>"+(b.text||"")+"</h2>":b.type==="paragraph"?"<p>"+(b.text||"")+"</p>":b.type==="quote"?"<blockquote>"+(b.text||"")+"</blockquote>":b.type==="image"?"<p><img src='"+(b.url||"")+"' alt='"+(b.caption||"")+"'></p>":"").join(""))} onChange={html=>change("content_html",html)} onImageUpload={async file=>{let result:string|null=null;await upload(file,url=>{result=url});return result;}}/><h2>Раздел</h2><label>Основной раздел<select value={post.section_id||""} onChange={e=>change("section_id",Number(e.target.value))}><option value="">Выберите раздел</option>{sections.map(sec=><option key={sec.id} value={sec.id}>{sec.title}</option>)}</select></label><details><summary>Управление разделами</summary><BlogSectionManager sections={sections} onUpdate={()=>supabase().from("blog_sections").select("*").order("sort_order").then(({data})=>setSections(data||[]))}/></details><h2>SEO</h2><label>SEO title<input value={post.seo_title||""} onChange={e=>change("seo_title",e.target.value)}/></label><label>SEO description<textarea value={post.seo_description||""} onChange={e=>change("seo_description",e.target.value)}/></label><div className="blog-save"><button disabled={busy||uploading} onClick={()=>save("draft")}>Сохранить черновик</button><button disabled={busy||uploading} onClick={()=>save("published")}>Опубликовать</button></div><div className="blog-save"><button type="button" disabled={deploying||busy||uploading} onClick={()=>void deploy()}>{deploying?"Создаём коммит…":"Запустить SEO-деплой"}</button></div>{uploading&&<p role="status">Загружаем файл…</p>}{message&&<p role="alert">{message}</p>}</main>;
}

function BlogSectionManager({sections,onUpdate}:{sections:Section[];onUpdate:()=>void}){
 const [title,setTitle]=useState(""),[slug,setSlug]=useState(""),[description,setDescription]=useState(""),[seoTitle,setSeoTitle]=useState(""),[seoDescription,setSeoDescription]=useState(""),[message,setMessage]=useState("");
 async function create(){
  if(!title.trim()||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)){setMessage("Укажите название и URL латиницей через дефисы.");return;}
  const {error}=await supabase().from("blog_sections").insert({title,slug,description,seo_title:seoTitle||null,seo_description:seoDescription||null,sort_order:sections.length});
  if(error){setMessage(error.message);return;}setTitle("");setSlug("");setDescription("");setSeoTitle("");setSeoDescription("");setMessage("Раздел создан.");onUpdate();
 }
 return <div className="blog-sections-admin"><p>Разделы: {sections.map(s=>s.title).join(", ")||"пока нет"}</p><label>Название раздела<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>URL раздела<input value={slug} onChange={e=>setSlug(e.target.value.toLowerCase())} placeholder="kultura"/></label><label>Описание раздела<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><label>SEO title<input value={seoTitle} onChange={e=>setSeoTitle(e.target.value)}/></label><label>SEO description<textarea value={seoDescription} onChange={e=>setSeoDescription(e.target.value)}/></label><button type="button" className="blog-action" onClick={()=>void create()}>Создать раздел</button>{message&&<p role="status">{message}</p>}</div>;
}
