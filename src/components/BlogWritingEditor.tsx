import { useEffect, useRef } from "react";
import "../pages/Blog.css";

const SAFE_TAGS = new Set(["P","DIV","BR","H2","H3","B","STRONG","I","EM","U","S","A","UL","OL","LI","BLOCKQUOTE","FIGURE","FIGCAPTION","IMG","CODE"]);
function clean(html: string): string {
 const doc = new DOMParser().parseFromString(html,"text/html");
 // Keep link/image URLs only when their schemes are safe.
 function sanitize(node: Element): void {
  for(const el of Array.from(node.children)) {
   const href=el.getAttribute("href"),src=el.getAttribute("src"),alt=el.getAttribute("alt");
   sanitize(el);
   for(const a of Array.from(el.attributes)) el.removeAttribute(a.name);
   if(el.tagName==="A" && href && /^(https?:\/\/|\/)/i.test(href)) {el.setAttribute("href",href);el.setAttribute("rel","noopener noreferrer");}
   if(el.tagName==="IMG" && src && /^(https?:\/\/|\/)/i.test(src)) {el.setAttribute("src",src);el.setAttribute("alt",alt||"");el.setAttribute("loading","lazy");}
   if(!SAFE_TAGS.has(el.tagName)) {if(["SCRIPT","STYLE","IFRAME","OBJECT","SVG"].includes(el.tagName))el.remove();else el.replaceWith(...Array.from(el.childNodes));}
  }
 }
 sanitize(doc.body);
 return doc.body.innerHTML;
}
function escapeHtml(text:string):string {return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function markdownToHtml(text:string):string {
 const inline=(raw:string)=>escapeHtml(raw)
  .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g,(_m,label,url)=>'<a href="'+url+'">'+label+'</a>')
  .replace(/\\*\\*([^*\\n]+)\\*\\*/g,"<strong>$1</strong>")
  .replace(/__([^_\\n]+)__/g,"<strong>$1</strong>")
  .replace(/(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)/g,"<em>$1</em>")
  .replace(/(?<!_)_([^_\\n]+)_(?!_)/g,"<em>$1</em>")
  .replace(/~~([^~\\n]+)~~/g,"<s>$1</s>")
  .replace(/`([^`\\n]+)`/g,"<code>$1</code>");
 const lines=text.replace(/\\r\\n?/g,"\\n").split("\\n");
 const out:string[]=[];let list:"ul"|"ol"|null=null;
 const close=()=>{if(list){out.push("</"+list+">");list=null;}};
 for(const line of lines){
  const h=/^#{1,6}\\s+(.+)$/.exec(line);
  const bullet=/^\\s*[-*+]\\s+(.+)$/.exec(line);
  const numbered=/^\\s*\\d+[.)]\\s+(.+)$/.exec(line);
  if(bullet||numbered){const type=bullet?"ul":"ol";if(list!==type){close();out.push("<"+type+">");list=type;}out.push("<li>"+inline((bullet||numbered)![1])+"</li>");continue;}
  close();
  if(h){const level=h[0].startsWith("###")?"h3":"h2";out.push("<"+level+">"+inline(h[1])+"</"+level+">");}
  else if(/^>\\s?/.test(line))out.push("<blockquote>"+inline(line.replace(/^>\\s?/,""))+"</blockquote>");
  else if(line.trim())out.push("<p>"+inline(line)+"</p>");
  else out.push("<p><br></p>");
 }
 close();return out.join("");
}
function looksLikeMarkdown(text:string):boolean {
 return /(^|\\n)\\s*(?:#{1,6}\\s|[-*+]\\s|\\d+[.)]\\s|>\\s)|\\*\\*[^*\\n]+\\*\\*|\\[[^\\]]+\\]\\(https?:\\/\\//m.test(text);
}
export default function BlogWritingEditor({value,onChange,onImageUpload}:{value:string;onChange:(html:string)=>void;onImageUpload:(file:File)=>Promise<string|null>}) {
 const area=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null),selection=useRef<Range|null>(null);
 useEffect(()=>{if(area.current && document.activeElement!==area.current && area.current.innerHTML!==value)area.current.innerHTML=clean(value||"<p><br></p>");},[value]);
 function emit(){if(area.current)onChange(clean(area.current.innerHTML));}
 function remember(){const s=window.getSelection();if(s?.rangeCount && area.current?.contains(s.anchorNode))selection.current=s.getRangeAt(0).cloneRange();}
 function restore(){area.current?.focus();const s=window.getSelection();if(s && selection.current){s.removeAllRanges();s.addRange(selection.current);}}
 function command(cmd:string,arg?:string){restore();document.execCommand(cmd,false,arg);emit();remember();}
 function link(){const url=prompt("Адрес ссылки (https://…)")?.trim();if(!url||!/^https?:\/\//i.test(url))return;command("createLink",url);}
 async function insertImage(file:File){if(!file.type.startsWith("image/"))return;remember();const url=await onImageUpload(file);if(!url)return;restore();const img=document.createElement("img");img.src=url;img.alt=file.name;const p=document.createElement("p");p.append(img);const sel=window.getSelection();if(sel?.rangeCount){const range=sel.getRangeAt(0);range.collapse(false);range.insertNode(p);range.setStartAfter(p);range.collapse(true);sel.removeAllRanges();sel.addRange(range);}else area.current?.append(p);emit();}
 function onPaste(e:React.ClipboardEvent){const f=Array.from(e.clipboardData.files).find(x=>x.type.startsWith("image/"));if(f){e.preventDefault();void insertImage(f);return;}const html=e.clipboardData.getData("text/html");const text=e.clipboardData.getData("text/plain");e.preventDefault();if(html){document.execCommand("insertHTML",false,clean(html));}else if(looksLikeMarkdown(text)){document.execCommand("insertHTML",false,clean(markdownToHtml(text)));}else{document.execCommand("insertText",false,text);}emit();}
 const btn=(label:string,title:string,action:()=>void)=><button type="button" title={title} aria-label={title} onMouseDown={e=>e.preventDefault()} onClick={action}>{label}</button>;
 return <div className="blog-writing">
  <div className="blog-writing-toolbar" role="toolbar" aria-label="Форматирование статьи">
   {btn("¶","Обычный текст",()=>command("formatBlock","p"))}
   {btn("H2","Заголовок второго уровня",()=>command("formatBlock","h2"))}
   {btn("H3","Заголовок третьего уровня",()=>command("formatBlock","h3"))}
   {btn("Ж","Жирный",()=>command("bold"))}
   {btn("К","Курсив",()=>command("italic"))}
   {btn("🔗","Ссылка на выделенном тексте",link)}
   {btn("• ≡","Маркированный список",()=>command("insertUnorderedList"))}
   {btn("1. ≡","Нумерованный список",()=>command("insertOrderedList"))}
   {btn("❝","Цитата",()=>command("formatBlock","blockquote"))}
   {btn("↶","Отменить",()=>command("undo"))}
   {btn("↷","Повторить",()=>command("redo"))}
   {btn("▧","Вставить изображение",()=>fileInput.current?.click())}
  </div>
  <input ref={fileInput} type="file" accept="image/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void insertImage(f);e.target.value="";}}/>
  <div ref={area} className="blog-writing-area blog-prose" contentEditable suppressContentEditableWarning data-placeholder="Начните писать статью…" onInput={emit} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={onPaste} onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes("Files"))e.preventDefault();}} onDrop={e=>{const f=Array.from(e.dataTransfer.files).find(x=>x.type.startsWith("image/"));if(f){e.preventDefault();void insertImage(f);}}}/>
  <p className="blog-writing-hint">Перетащите изображение в текст или вставьте из буфера. Выделите текст и используйте панель форматирования.</p>
 </div>;
}
