import type { Request, Response } from "@octanuary/httpz";
import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { Writable } from "stream";

type UploadedFile = { filepath: string; originalFilename: string; mimetype: string; size: number; newFilename: string; };

export default async function reqBody(req: Request, res: Response, next: () => Promise<void>) { req.body = {}; req.files = {};
	if (req.method !== "POST") { res.setHeader("Access-Control-Allow-Origin", "*");
		return await next();
	}
	const contentType = req.headers["content-type"] || "";
	if (contentType.includes("application/json")) {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const raw = Buffer.concat(chunks).toString("utf8");
		if (raw) {
			req.body = JSON.parse(raw);
		}
	} 
	else if (contentType.includes("application/x-www-form-urlencoded")) {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		const raw = Buffer.concat(chunks).toString("utf8");
		const fields: Record<string, string> = {};
		for (const part of raw.split("&")) {
			if (!part) continue;
			const [k, v] = part.split("=");
			fields[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent((v || "").replace(/\+/g, " ")); }
		req.body = fields;
	} 
	else if (contentType.includes("multipart/form-data")) {
		const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
		if (boundaryMatch) {
			const boundaryStr = boundaryMatch[1] || boundaryMatch[2];
			await new Promise<void>((resolve, reject) => {
				const fields: Record<string, string | string[]> = {};
				const files: Record<string, UploadedFile | UploadedFile[]> = {};
				const pending: Promise<void>[] = [];
				const boundaryBytes = Buffer.from(`--${boundaryStr}`);
				const lookaheadBytes = Buffer.from(`\r\n--${boundaryStr}`);
				let dataBuffer = Buffer.alloc(0);
				let state = 0; 
				let ptr = 0;
				let headerText = "";
				let currentFieldName = "";
				let currentFilename = "";
				let currentMimeType = "";
				let fileWriteStream: fs.WriteStream | null = null;
				let currentFilePath = "";
				let currentFileSize = 0;
				let fieldBuffer = Buffer.alloc(0);
				const parser = new Writable({ write(chunk, encoding, callback) { dataBuffer = Buffer.concat([dataBuffer, chunk]);
					while (ptr < dataBuffer.length) {
						if (state === 0) {
							const idx = dataBuffer.indexOf(boundaryBytes, ptr);
							if (idx === -1) { dataBuffer = dataBuffer.subarray(Math.max(0, dataBuffer.length - boundaryBytes.length)); ptr = 0;
								break;
							}
							ptr = idx + boundaryBytes.length;
							if (ptr + 2 <= dataBuffer.length && dataBuffer[ptr] === 45 && dataBuffer[ptr + 1] === 45) { dataBuffer = Buffer.alloc(0); ptr = 0;
								break;
							}
							state = 1;
							headerText = "";
						} else if (state === 1) {
							const headerEnd = dataBuffer.indexOf("\r\n\r\n", ptr);
							if (headerEnd === -1) { dataBuffer = dataBuffer.subarray(ptr); ptr = 0;
								break;
							}
							headerText = dataBuffer.subarray(ptr, headerEnd).toString("utf8");
							ptr = headerEnd + 4;
							const dispMatch = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
							if (dispMatch) {
								currentFieldName = dispMatch[1];
								const filename = dispMatch[2];
								if (filename !== undefined) {
									currentFilename = filename || "upload";
									const mimeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
									currentMimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
									const newFilename = randomBytes(16).toString("hex");
									currentFilePath = path.join(os.tmpdir(), newFilename);
									fileWriteStream = fs.createWriteStream(currentFilePath);
									currentFileSize = 0;
									const p = new Promise<void>((resFile, rejFile) => {
										const capturedFieldName = currentFieldName;
										const capturedFilename = currentFilename;
										const capturedMimeType = currentMimeType;
										const targetPath = currentFilePath;
										const targetNewName = newFilename;
										const targetStream = fileWriteStream!;
										targetStream.on("finish", () => {
											const fileObj: UploadedFile = { filepath: targetPath, originalFilename: capturedFilename, mimetype: capturedMimeType, size: targetStream.bytesWritten, newFilename: targetNewName, };
											if (files[capturedFieldName] === undefined) { files[capturedFieldName] = fileObj;}
											else if (Array.isArray(files[capturedFieldName])) { (files[capturedFieldName] as UploadedFile[]).push(fileObj); }
											else { files[capturedFieldName] = [files[capturedFieldName] as UploadedFile, fileObj]; }
											resFile();
										});
										targetStream.on("error", (err) => {
											rejFile(err);
										});
									});
									pending.push(p);
								} else { fileWriteStream = null; fieldBuffer = Buffer.alloc(0); }
							}
							state = 2;
						} else if (state === 2) {
							const bIdx = dataBuffer.indexOf(lookaheadBytes, ptr);
							if (bIdx === -1) {
								const safeLength = dataBuffer.length - ptr - (lookaheadBytes.length + 4);
								if (safeLength > 0) {
									const chunkToFlush = dataBuffer.subarray(ptr, ptr + safeLength);
									if (fileWriteStream) { fileWriteStream.write(chunkToFlush); currentFileSize += chunkToFlush.length; }
									else if (currentFieldName) { fieldBuffer = Buffer.concat([fieldBuffer, chunkToFlush]); }
									ptr += safeLength;
								}
								dataBuffer = dataBuffer.subarray(ptr);
								ptr = 0;
								break;
							} else {
								const finalChunk = dataBuffer.subarray(ptr, bIdx);
								if (fileWriteStream) { fileWriteStream.write(finalChunk); currentFileSize += finalChunk.length; fileWriteStream.end(); fileWriteStream = null; }
								else if (currentFieldName) { const merged = Buffer.concat([fieldBuffer, finalChunk]); const val = merged.toString("utf8");
									if (fields[currentFieldName] === undefined) { fields[currentFieldName] = val; }
									else if (Array.isArray(fields[currentFieldName])) { (fields[currentFieldName] as string[]).push(val);}
									else { fields[currentFieldName] = [fields[currentFieldName] as string, val]; }fieldBuffer = Buffer.alloc(0); } ptr = bIdx + 2; state = 0;} } }
					callback();
					},
					final(callback) {
						Promise.all(pending) .then(() => { req.body = fields; req.files = files; resolve(); callback(); }) }
				});
				parser.on("error", (err) => { reject(err); });
				req.pipe(parser);
			});
		} else { }
	}
	res.setHeader("Access-Control-Allow-Origin", "*");
	await next();
}
