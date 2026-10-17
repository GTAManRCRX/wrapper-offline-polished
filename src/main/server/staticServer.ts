import Directories from "../storage/directories";
import fileUtil from "./utils/fileUtil";
import handler from "serve-handler";
import { IncomingMessage, ServerResponse } from "http";
import { zipSync } from "fflate";
import path from "path";
import { readFileSync, existsSync } from "fs";

interface CCCharObject { id: number; name: string; category: string; }

const STATIC_SERVER_HOST = process.env.STATIC_SERVER_HOST;
const STATIC_SERVER_PORT = process.env.STATIC_SERVER_PORT;

const themeZipPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/\1\.zip$/;
const themeXmlPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/theme\.xml$/;
let stockCharsIndex: Record<string, CCCharObject[]> | null = null;
const fixedThemeXmlCache = new Map<string, Buffer>();
const themeZipCache = new Map<string, Buffer>();

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
	if (start === -1) {
		fixedThemeXmlCache.set(themeId, themeXml);
		return themeXml;
	}
	const ccThemeIdStart = start + marker.length;
	const ccThemeIdEnd = themeXml.indexOf('"', ccThemeIdStart);
	const ccThemeId = themeXml.subarray(ccThemeIdStart, ccThemeIdEnd).toString();
	const stockChars = getStockCharsIndex()[themeId] || [];
	const charBlock = Buffer.from( stockChars.map((c) => ccCharObject2Xml(c, ccThemeId)).join("") );
	const endInd = themeXml.indexOf("</theme>");
	const result = Buffer.concat([ themeXml.subarray(0, endInd), charBlock, Buffer.from("</theme>"), ]);
	fixedThemeXmlCache.set(themeId, result);
	return result;
}
function handleStudioTheme( themeId: string, returnZip: boolean, res: ServerResponse ) {
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
		res.end(zipped);
	} else {
		res.setHeader("Content-Type", "application/xml");
		res.end(themeXml);
	}
}
export default async function staticServer( req: IncomingMessage, res: ServerResponse) {
	const url = req.url || "";
	const themeXmlMatch = url.match(themeXmlPattern);
	if (themeXmlMatch) {
		return handleStudioTheme(themeXmlMatch[1], false, res);
	}
	const themeZipMatch = url.match(themeZipPattern);
	if (themeZipMatch) {
		return handleStudioTheme(themeZipMatch[1], true, res);
	}
	await handler(req, res, {
		public: Directories.static,
		headers: {
			"Cache-Control": "no-store",
		},
	});
}
