import { remoteFetch,readLimited,requestUrl,remoteError } from "@/lib/remote";
import { parseChapter } from "@/lib/archive";
export async function POST(request:Request){try{const url=await requestUrl(request);const response=await remoteFetch(url,AbortSignal.any([request.signal,AbortSignal.timeout(30000)]));const bytes=await readLimited(response,2*1024*1024);const chapter=parseChapter(new TextDecoder().decode(bytes));return Response.json({name:chapter.name,chapter:{chapter:chapter.chapter,img:chapter.images}},{headers:{"Cache-Control":"no-store"}})}catch(e){return remoteError(e)}}
