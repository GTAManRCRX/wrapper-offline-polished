import Directories from "../storage/directories";
import fileUtil from "./utils/fileUtil";
import { IncomingMessage, ServerResponse } from "http";
import { zipSync } from "fflate";
import path from "path";
import { readFileSync, existsSync, createReadStream, statSync } from "fs";
import { URL } from "url";

interface CCCharObject { id: number; name: string; category: string; }

const STATIC_SERVER_HOST = process.env.STATIC_SERVER_HOST;
const STATIC_SERVER_PORT = process.env.STATIC_SERVER_PORT;

const themeZipPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/\1\.zip$/;
const themeXmlPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/theme\.xml$/;
let stockCharsIndex: Record<string, CCCharObject[]> | null = null;
const fixedThemeXmlCache = new Map<string, Buffer>();
const themeZipCache = new Map<string, Buffer>();

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".xml": "application/xml; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".zip": "application/zip",
	".map": "application/json",
	".swf": "application/x-shockwave-flash",
	".bin": "application/octet-stream",
};
function getStockCharsIndex(): Record<string, CCCharObject[]> {
	if (!stockCharsIndex) {
		const filepath = path.join(Directories.static, "characters/index.json");
		stockCharsIndex = JSON.parse(readFileSync(filepath, "utf-8"));
	}
	return stockCharsIndex!;
}
function ccCharObject2Xml(char: CCCharObject, themeId: string): string {
	const name = char.name || "Untitled";
	const category = char.category || "Stock characters";
	return ( `<char id="${char.id}" name="${name}" cc_theme_id="${themeId}" ` + `thumbnail_url="${STATIC_SERVER_HOST}:${STATIC_SERVER_PORT}/thumbnails/${char.id}.png" copyable="Y">` + `<tags>${themeId},_free,_cat:${category}</tags></char>` );
}
function fixThemeXml(themeId: string, themeXml: Buffer): Buffer {
	const cached = fixedThemeXmlCache.get(themeId);
	if (cached) return cached;
	const marker = 'cc_theme_id="';
	const start = themeXml.indexOf(marker);
	if (start === -1) { fixedThemeXmlCache.set(themeId, themeXml); return themeXml; }
	const ccThemeIdStart = start + marker.length;
	const ccThemeIdEnd = themeXml.indexOf('"', ccThemeIdStart);
	const ccThemeId = themeXml.subarray(ccThemeIdStart, ccThemeIdEnd).toString();
	const stockChars = getStockCharsIndex()[themeId] || [];
	const charBlock = Buffer.from(
		stockChars.map((c) => ccCharObject2Xml(c, ccThemeId)).join("")
	);
	const endInd = themeXml.indexOf("</theme>");
	const result = Buffer.concat([ themeXml.subarray(0, endInd), charBlock, Buffer.from("</theme>"), ]);
	fixedThemeXmlCache.set(themeId, result);
	return result;
}
function handleStudioTheme( themeId: string, returnZip: boolean, res: ServerResponse) {
	const filepath = path.join(Directories.store, themeId, "theme.xml");
	if (!existsSync(filepath)) {
		res.statusCode = 404;
		res.end("Theme not found");
		return;
	}
	const themeXml = fixThemeXml(themeId, readFileSync(filepath));
	if (returnZip) {
		let zipped = themeZipCache.get(themeId);
		if (!zipped) {
			const files: Record<string, Uint8Array> = {};
			fileUtil.addToZip(files, "theme.xml", themeXml);
			zipped = Buffer.from(zipSync(files));
			themeZipCache.set(themeId, zipped);
		}
		res.setHeader("Content-Type", "application/zip");
		res.setHeader("Content-Length", zipped.length);
		res.end(zipped);
	} else {
		res.setHeader("Content-Type", "application/xml");
		res.setHeader("Content-Length", themeXml.length);
		res.end(themeXml);
	}
}
function serveStaticFile(req: IncomingMessage, res: ServerResponse) {
	const publicDir = path.resolve(Directories.static);
	const parsed = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	let pathname = decodeURIComponent(parsed.pathname);

	if (pathname === "/") {
		pathname = "/index.html";
	}
	let filePath = path.normalize(path.join(publicDir, pathname));
	if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
		res.statusCode = 403;
		res.end("Forbidden");
		return;
	}
	try {
		let stats = statSync(filePath);
		if (stats.isDirectory()) {
			filePath = path.join(filePath, "index.html");
			stats = statSync(filePath);
		}
		if (!stats.isFile()) {
			res.statusCode = 404;
			res.end("Not found");
			return;
		}
		const fileSize = stats.size;
		const ext = path.extname(filePath).toLowerCase();
		const contentType = MIME_TYPES[ext] || "application/octet-stream";
		res.setHeader("Content-Type", contentType);
		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Accept-Ranges", "bytes");
		const range = req.headers.range;
		if (range) {
			const match = /bytes=(\d+)-(\d*)/.exec(range);
			if (match) {
				const start = parseInt(match[1], 10);
				const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
				if (start >= fileSize || end >= fileSize || start > end) {
					res.statusCode = 416;
					res.setHeader("Content-Range", `bytes */${fileSize}`);
					res.end();
					return;
				}
				res.statusCode = 206;
				res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
				res.setHeader("Content-Length", end - start + 1);
				createReadStream(filePath, { start, end }).pipe(res);
				return;
			}
		}
		res.setHeader("Content-Length", fileSize);
		createReadStream(filePath).pipe(res);
	} catch (err) {
		res.statusCode = 404;
		res.end("Not found");
	}
}
export default async function staticServer(
	req: IncomingMessage,
	res: ServerResponse
) {
	const url = req.url || "";
	const themeXmlMatch = url.match(themeXmlPattern);
	if (themeXmlMatch) {
		return handleStudioTheme(themeXmlMatch[1], false, res);
	}
	const themeZipMatch = url.match(themeZipPattern);
	if (themeZipMatch) {
		return handleStudioTheme(themeZipMatch[1], true, res);
	}
	serveStaticFile(req, res);
}
