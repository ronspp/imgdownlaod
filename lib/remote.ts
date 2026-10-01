export class RemoteHttpError extends Error { constructor(public status:number){super(`El origen respondió HTTP ${status}. Puede que el archivo no exista o tenga acceso restringido.`);this.name="RemoteHttpError";} }
// Public HTTP resources only. Every redirect is revalidated; cookies and auth are never forwarded.
export function publicUrl(input:unknown):URL{
 if(typeof input!=="string"||input.length>8192)throw new Error("Introduce una URL válida.");
 let url:URL;try{url=new URL(input.trim())}catch{throw new Error("Introduce una URL HTTP o HTTPS válida.")}
 if(!["https:","http:"].includes(url.protocol)||url.username||url.password||url.port)throw new Error("Solo se admiten URL públicas HTTP o HTTPS, sin credenciales ni puertos personalizados.");
 const host=url.hostname.toLowerCase().replace(/\.$/,"");
 if(!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/.test(host)||/(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)||host==="metadata.google.internal")throw new Error("La URL debe apuntar a un dominio público.");
 url.hostname=host;return url;
}
export function publicIp(ip:string){
 if(ip.includes(":"))return /^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0|2|10|20):/i.test(ip)&&!/^2002:/i.test(ip);
 const n=ip.split(".").map(Number);if(n.length!==4||n.some(v=>!Number.isInteger(v)||v<0||v>255))return false;
 const[a,b,c]=n;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
async function checkDns(host:string,signal:AbortSignal){
 const records=await Promise.all(["A","AAAA"].map(async type=>{const response=await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,{headers:{Accept:"application/dns-json"},signal});if(!response.ok)throw new Error("No se pudo verificar el dominio del origen.");const data=await response.json() as {Status:number;Answer?:{type:number;data:string}[]};if(data.Status!==0)throw new Error("No se encontró el dominio del origen.");return(data.Answer||[]).filter(r=>r.type===1||r.type===28).map(r=>r.data)}));
 const ips=records.flat();if(!ips.length||ips.some(ip=>!publicIp(ip)))throw new Error("El origen debe usar una dirección de Internet pública.");
}
export function outboundHeaders(url:URL,kind:"json"|"image"="json"):Record<string,string>{
 const headers:Record<string,string>={Accept:"application/json,image/*;q=0.9,*/*;q=0.5"};
 // This image host requires its reader site's reference. Recompute on every
 // redirect so the site-specific headers never reach unrelated destinations.
 if(kind==="image"&&url.hostname==="img2mw.xyz"){
  headers.Referer="https://manhwaweb.com/";
  headers.Origin="https://manhwaweb.com";
 }
 return headers;
}
export async function remoteFetch(raw:unknown,signal:AbortSignal,kind:"json"|"image"="json"){let url=publicUrl(raw);for(let i=0;i<5;i++){await checkDns(url.hostname,signal);const response=await fetch(url,{redirect:"manual",signal,headers:outboundHeaders(url,kind),credentials:"omit",cache:"no-store"});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get("Location");await response.body?.cancel();if(!location)throw new Error("El origen devolvió una redirección inválida.");url=publicUrl(new URL(location,url).href);continue;}if(!response.ok){await response.body?.cancel();throw new RemoteHttpError(response.status);}return response;}throw new Error("El origen tiene demasiadas redirecciones.");}
export async function readLimited(response:Response,max:number){if(Number(response.headers.get("content-length")||0)>max){await response.body?.cancel();throw new Error("El archivo supera el tamaño permitido.");}if(!response.body)throw new Error("El origen no devolvió contenido.");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;try{while(true){const{value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw new Error("El archivo supera el tamaño permitido.");}chunks.push(value)}}finally{reader.releaseLock()}if(!total)throw new Error("El archivo está vacío.");const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;}
export async function requestUrl(request:Request){const origin=request.headers.get("Origin");if(origin&&origin!==new URL(request.url).origin)throw new Error("Origen de solicitud no permitido.");const raw=await readLimited(request as unknown as Response,16000);let parsed;try{parsed=JSON.parse(new TextDecoder().decode(raw))}catch{throw new Error("Solicitud JSON inválida.");}return publicUrl(parsed.url).href;}
export function remoteError(e:unknown){const message=e instanceof Error?e.message:"No se pudo acceder al origen.";return Response.json({upstreamStatus:e instanceof RemoteHttpError?e.status:undefined,error:/abort|timeout/i.test(message)?"El origen tardó demasiado en responder. Inténtalo de nuevo.":message},{status:400,headers:{"Cache-Control":"no-store"}});}
