import Directories from "../storage/directories";
import fileUtil from "./utils/fileUtil";
import handler from "serve-handler";
import { IncomingMessage, ServerResponse } from "http";
import { zipSync } from "fflate";
import path from "path";
import { readFileSync } from "fs";

interface CCCharObject {
	id: number;
	name: string;
	category: string;
}
const STATIC_SERVER_HOST = process.env.STATIC_SERVER_HOST;
const STATIC_SERVER_PORT = process.env.STATIC_SERVER_PORT;
const ccCharObject2Xml = (char: CCCharObject, themeId: string) =>
	`<char id="${char.id}" name="${char.name || "Untitled"}" cc_theme_id="${themeId}" thumbnail_url="${STATIC_SERVER_HOST}:${STATIC_SERVER_PORT}/thumbnails/${char.id}.png" copyable="Y">
		<tags>${themeId},_free,_cat:${char.category || "Stock characters"}</tags>
	</char>`;
const themeZipPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/\1.zip$/;
const themeXmlPattern = /^\/store\/[\da-zA-Z]+\/([\S]+)\/theme.xml$/;
async function handleStudioTheme(
	themeId: string,
	returnZip: boolean,
	res: ServerResponse
) {
	const filepath = path.join(Directories.store, themeId, "theme.xml");
	const themeXml = fixThemeXml(themeId, readFileSync(filepath));
	if (returnZip) {
		const files: Record<string, Uint8Array> = {};
		fileUtil.addToZip(files, "theme.xml", themeXml);
		const zipped = zipSync(files);
		res.setHeader("Content-Type", "application/zip");
		res.end(Buffer.from(zipped));
	} else {
		res.setHeader("Content-Type", "application/xml");
		res.end(themeXml);
	}
}
function fixThemeXml(themeId: string, themeXml: Buffer): Buffer {
	const ccThemeIdStart = themeXml.indexOf('cc_theme_id="') + 13;
	if (ccThemeIdStart == 12) {
		return themeXml;
	}
	const ccThemeIdEnd = themeXml.indexOf('"', ccThemeIdStart);
	const ccThemeId = themeXml.subarray(ccThemeIdStart, ccThemeIdEnd).toString();

	const stockChars = readStockCCChars(themeId);
	const charBlock = Buffer.from(
		stockChars
			.map((c) => {
				return ccCharObject2Xml(c, ccThemeId);
			})
			.join("")
	);
	const endInd = themeXml.indexOf("</theme>");
	return Buffer.concat([
		themeXml.subarray(0, endInd),
		charBlock,
		Buffer.from("</theme>"),
	]);
}
function readStockCCChars(themeId: string): CCCharObject[] {
	const filepath = path.join(Directories.static, "characters/index.json");
	const contents = readFileSync(filepath, {
		encoding: "utf-8",
	});
	if (contents.indexOf(themeId) == -1) {
		return [];
	}
	const stockChars = JSON.parse(contents);
	return stockChars[themeId];
}
export default async function staticServer(
	req: IncomingMessage,
	res: ServerResponse
) {
	const themeXmlMatch = req.url.match(themeXmlPattern);
	if (themeXmlMatch) {
		return handleStudioTheme(themeXmlMatch[1], false, res);
	}
	const themeZipMatch = req.url.match(themeZipPattern);
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
