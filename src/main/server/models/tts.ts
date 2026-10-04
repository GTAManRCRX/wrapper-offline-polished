import https from "https";
import voiceList from "../data/voices.json";
import fileUtil from "../utils/fileUtil"
import { Readable } from "stream";
import { URLSearchParams } from "url";
import { brotliDecompress } from "zlib";
import crypto from "crypto";

const VOICEFORGE_SERVER_URL = "https://voiceforge-tcvi.onrender.com";

function voiceForgeGenerateSpeech(text, voice) {
  return new Promise((resolve2, reject2) => {
    const body = JSON.stringify({ text, voice });
    const url = new URL(`${VOICEFORGE_SERVER_URL}/generate`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (r) => {
      const buffers = [];
      r.on("data", (chunk) => buffers.push(chunk));
      r.on("end", () => {
        const responseBody = Buffer.concat(buffers);
        if (r.statusCode < 200 || r.statusCode >= 300) {
          let message = `VoiceForge server returned HTTP ${r.statusCode}.`;
          try {
            const json = JSON.parse(responseBody.toString());
            if (json.error) message += ` ${json.error}`;
            else if (json.message) message += ` ${json.message}`;
          } catch (e) {}
          return reject2(message);
        }
        const { PassThrough } = require("stream");
        const stream = new PassThrough();
        stream.end(responseBody);
        resolve2(stream);
      });
      r.on("error", reject2);
    });
    req.on("error", reject2);
    req.end(body);
  });
}

export default function processVoice(
	voiceName: string,
	text: string
): Promise<Buffer | Readable> {
	return new Promise(async (resolve, reject) => {
		const voice = voiceList.voices[voiceName];
		if (!voice) {
			return reject("Requested voice is not supported");
		}

		const cleanText = text.includes("#%") ? text.split("#%").pop() : text;

		try {
			switch (voice.source) {
				case "acapela": {
					const q = new URLSearchParams({
						voice: voice.arg,
						text: text,
						output: "stream",
						type: "mp3",
						samplerate: 22050,
						token: "bd8b22e3e5ebbaa05ea0055aec4e16c357c29486",
					}).toString();
					https.get({
						hostname: "acapela-cloud.com",
						path: `/api/command/?${q}`,
						headers: {
							"Host": "acapela-cloud.com",
							"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:107.0) Gecko/20100101 Firefox/107.0",
							"Referer": "https://www.acapela-group.com",
							"Origin": "https://www.acapela-group.com"
						}
					}, (res) => {
						if (res.statusCode !== 200) {
							return reject(`Acapela cloud error: ${res.statusCode}. Token might be expired.`);
						}
						resolve(res);
					}).on("error", reject);
					break;
				}
				case "baidu": {
					const q = new URLSearchParams({
						lan: voice.arg,
						text: text,
						spd: "5",
						source: "web",
					}).toString();
					https.get({
						hostname: "fanyi.baidu.com",
						path: `/gettts?${q}`,
						headers: {
							"User-Agent": "Mozilla/5.0",
							"Referer": "https://fanyi.baidu.com"
						}
					}, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`Baidu error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "bing": {
					const body = new URLSearchParams({
						text: text,
						voice: voice.arg,
						service: "Bing Translator",
					}).toString();
					const req = https.request({
						hostname: "lazypy.ro",
						path: "/tts/request_tts.php",
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
							"Content-Length": Buffer.byteLength(body)
						}
					}, (res) => {
						let chunks = [];
						res.on("data", (chunk) => chunks.push(chunk));
						res.on("end", () => {
							try {
								const json = JSON.parse(Buffer.concat(chunks).toString());
								
								if (json.success !== true) {
									return reject(`Bing proxy error: ${json.error_msg || "Unknown error"}`);
								}
								https.get(json.audio_url, (audioRes) => {
									if (audioRes.statusCode !== 200) {
										return reject(`Bing audio download error: ${audioRes.statusCode}`);
									}
									resolve(audioRes);
								}).on("error", reject);
							} catch (e) {
								reject("Bing proxy error: Invalid JSON response from lazypy");
							}
						});
					});
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					req.end(body);
					break;
				}
				case "cereproc": {
					const req = https.request({
						hostname: "app.cereproc.com",
						path: "/live-demo?ajax_form=1&_wrapper_format=drupal_ajax",
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
							"Accept-Encoding": "gzip, deflate, br",
							"Origin": "https://app.cereproc.com",
							"Referer": "https://app.cereproc.com",
							"X-Requested-With": "XMLHttpRequest"
						},
					}, (r1) => {
						let buffers = [];
						r1.on("data", (d) => buffers.push(d));
						r1.on("end", () => {
							brotliDecompress(Buffer.concat(buffers), (err, data) => {
								if (err) return reject(`Cereproc decompression error: ${err.message}`);
								try {
									const responseData = JSON.parse(data.toString());
									const entry = responseData.find(e => typeof e.data == "string" && e.data.includes('cerevoice.s3.amazonaws.com'));
									
									if (!entry) return reject("Cereproc: Audio link not found");
									
									const xml = entry.data;
									const beg = xml.indexOf("https://");
									const end = xml.lastIndexOf(".wav") + 4;
									const loc = xml.substring(beg, end);

									https.get(loc, (r2) => {
										fileUtil.convertToMp3(r2, "wav")
											.then(resolve)
											.catch(reject);
									}).on("error", reject);
								} catch (e) {
									reject("Cereproc JSON error: " + e.message);
								}
							});
						});
						r1.on("error", reject);
					});
					req.on("error", reject);
					req.write(new URLSearchParams({
						text: text,
						voice: voice.arg,
						form_id: "live_demo_form"
					}).toString());
					req.end();
					break;
				}
				case "cobaltspeech": {
					const q = new URLSearchParams({
						"text.text": text,
						"config.model_id": voice.lang,
						"config.speaker_id": voice.arg,
						"config.speech_rate": "1",
						"config.variation_scale": "0",
						"config.audio_format.codec": "AUDIO_CODEC_WAV"
					}).toString();
					https.get({
						hostname: "demo.cobaltspeech.com",
						path: `/voicegen/api/voicegen/v1/streaming-synthesize?${q}`,
						headers: { "Accept": "*/*" }
					}, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`Cobalt error: ${audioRes.statusCode}`);
						}
						fileUtil.convertToMp3(audioRes, "wav")
							.then(resolve)
							.catch((e) => reject(`Conversion error: ${e.message}`));

					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "googletranslate": {
					const q = new URLSearchParams({
						ie: "UTF-8",
						total: "1",
						idx: "0",
						client: "tw-ob",
						q: text,
						tl: voice.arg,
					}).toString();
					https.get(`https://translate.google.com/translate_tts?${q}`, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`Google TTS error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "neospeechold": {
					const q = new URLSearchParams({
						speed: "0",
						apikey: "38fcab81215eb701f711df929b793a89",
						text: text,
						action: "convert",
						voice: voice.arg,
						format: "mp3",
						e: "audio.mp3"
					}).toString();
					https.get(`https://api.ispeech.org/api/rest?${q}`, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`Neospeech (iSpeech) error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
 				case "onecore": {
					const body = JSON.stringify([{
						voiceId: voice.arg,
						ssml: `<speak version="1.0" xml:lang="${voice.lang}">${text}</speak>`
					}]);
					const req = https.request({
						hostname: "support.readaloud.app",
						path: "/ttstool/createParts",
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(body)
						}
					}, (r) => {
						let chunks = [];
						r.on("data", (d) => chunks.push(d));
						r.on("error", reject);
						r.on("end", () => {
							try {
								const json = JSON.parse(Buffer.concat(chunks).toString());
								const fileId = json[0];
								if (!fileId) return reject("OneCore error: No part ID received");
								https.get({
									hostname: "support.readaloud.app",
									path: `/ttstool/getParts?q=${fileId}`,
									headers: { "Accept": "audio/mp3" }
								}, resolve).on("error", reject); //
							} catch (e) {
								reject("OneCore error: Invalid JSON response from support.readaloud.app");
							}
						});
					});
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					req.end(body);
					break;
				}
				case "onecoretwo": {
					const q = new URLSearchParams({
						hl: voice.lang,
						c: "MP3",
						f: "16khz_16bit_stereo",
						v: voice.arg,
						src: text,
					}).toString();
					https.get(`https://api.voicerss.org/?key=83baa990727f47a89160431e874a8823&${q}`, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`VoiceRSS error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "polly": {
					const q = new URLSearchParams({
						voice: voice.arg,
						text: text,
					}).toString();
					const req = https.get(
						{
							hostname: "streamlabs.com",
							path: `/polly/speak?${q}`,
							method: "POST",
							headers: {"referer": "https://streamlabs.com"}
						}, (r) => {
							let body = "";
							r.on("data", (d) => body += d);
							r.on("end", () => {
								try {
									const json = JSON.parse(body);
									if (!json.success) {
										return reject("Polly error: " + json.message);
									}
									const url = json.speak_url;
									https.get(url, resolve);
								} catch (e) {
									return reject(e);
								}
							});
						}
					);
					req.on("error", (err) => reject(`Polly network request failed: ${err.message}`));
					break;
				}
				case "pollytwo": {
					const body = new URLSearchParams({
						msg: text,
						lang: voice.arg,
						source: "ttsmp3"
					}).toString();
					const req = https.request({
						hostname: "ttsmp3.com",
						path: "/makemp3_new.php",
						method: "POST",
						headers: { 
							"Content-Type": "application/x-www-form-urlencoded",
							"Content-Length": Buffer.byteLength(body)
						}
					}, (res) => {
						let chunks = [];
						res.on("data", (chunk) => chunks.push(chunk));
						res.on("end", () => {
						try {
							const json = JSON.parse(Buffer.concat(chunks).toString());
							if (json.Error === 1) return reject(json.Text);
							const audioUrl = json.URL.startsWith("https") ? json.URL : json.URL.replace("http", "https");
							https.get(audioUrl, resolve).on("error", (e) => reject(`Audio download error: ${e.message}`));
						} catch (e) {
							reject("Invalid JSON from ttsmp3.com");
						}
					});
				});
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					req.end(body);
					break;
				}
				case "readloud": {
					const body = new URLSearchParams({ but1: text, butS: 0, butP: 0, butPauses: 0, butt0: "Submit" }).toString();
					const headers = { "User-Agent": "Mozilla/5.0", Referer: "https://readloud.net", Origin: "https://readloud.net" };
					const req = https.request({
						hostname: "readloud.net", 
						path: voice.arg, 
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }
					}, (r) => {
						if (r.statusCode !== 200) return reject(`HTTP ${r.statusCode}`);
						let html = "";
						r.on("data", (b) => html += b);
						r.on("end", () => {
							const beg = html.indexOf("/tmp/");
							if (beg === -1) return reject("MP3 link not found");
							const sub = html.substring(beg, html.indexOf("mp3", beg) + 3);
							https.get({ hostname: "readloud.net", path: sub, headers }, (r2) => {
								if (r2.statusCode !== 200) return reject(`MP3 HTTP ${r2.statusCode}`);
								resolve(r2);
							}).on("error", reject);
						});
					}).on("error", reject);
					req.end(body);
					break;
				}
				case "sapi4": {
					const q = new URLSearchParams({
						text,
						voice: voice.arg
					}).toString();
					const req = https.get({
						hostname: "www.tetyys.com",
						path: `/SAPI4/SAPI4?${q}`,
						headers: { "Accept": "audio/wav" }
					}, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`SAPI4 error: ${audioRes.statusCode}`);
						}
						fileUtil.convertToMp3(audioRes, "wav")
							.then(resolve)
							.catch((e) => reject(`SAPI4 conversion error: ${e.message}`));

					});
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "svox": {
					const q = new URLSearchParams({
						speed: "0",
						apikey: "ispeech-listenbutton-betauserkey",
						text: text,
						action: "convert",
						voice: voice.arg,
						format: "mp3",
						e: "audio.mp3"
					}).toString();
					https.get(`https://api.ispeech.org/api/rest?${q}`, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`iSpeech error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					}).on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "tiktok": {
					text = text.slice(0, 199).trim();
					const params = new URLSearchParams({
						aid: "1233",
						req_text: text,
						region: voice.country,
						text_speaker: voice.arg,
					}).toString();
					const req = https.request(
						{
							hostname: "api16-normal-useast5.us.tiktokv.com",
							path: `/media/api/text/speech/invoke/?${params}`,
							method: "POST",
							headers: {
								"cache-control": "no-cache",
								"content-type": "application/json",
								"cookie": "sessionid=cc11cb1a8f38fd855aad30660349dd8a",
								"responsetype": "ResponseType.json",
								"sdk-version": "2",
								"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:98.0) Gecko/20100101 Firefox/98.0"
							},
							timeout: 10000
						},
						(r) => {
							if (r.statusCode < 200 || r.statusCode >= 300) {
								return reject(`TikTok server returned HTTP ${r.statusCode}`);
							}
							let body = "";
							r.on("error", (e) => reject(e));
							r.on("data", (c) => body += c);
							r.on("end", () => {
								try {
									const json = JSON.parse(body);
									if (json.status_code !== 0) {
										return reject(`TikTok API error: ${json.status_code} - ${json.message || "Unknown error"}`);
									}
									if (!json.data || !json.data.v_str) {
										return reject("TikTok API response is missing voice data");
									}
									resolve(Buffer.from(json.data.v_str, "base64"));
								} catch (e) {
									reject(`Failed to parse TikTok response: ${e.message}`);
								}
							});
						}
					);
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					req.on("timeout", () => {req.destroy();
						reject("TikTok request timed out");
					});
					req.end();
					break;
				}
				case "vocalware": {
					const [EID, LID, VID] = voice.arg;
					const q = new URLSearchParams({
						EID,
						LID,
						VID,
						TXT: text,
						EXT: "mp3",
						FNAME: "",
						ACC: "15679",
						SceneID: "2703396",
						HTTP_ERR: "",
					}).toString();
					const req = https.get({
						hostname: "cache-a.oddcast.com",
						path: `/tts/genB.php?${q}`,
						headers: {
							"Referer": "https://www.oddcast.com/",
							"Origin": "https://www.oddcast.com",
							"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
							"Accept": "*/*"
						}
					}, (audioRes) => {
						if (audioRes.statusCode !== 200) {
							return reject(`Vocalware error: ${audioRes.statusCode}`);
						}
						resolve(audioRes);
					});
					req.on("error", (e) => reject(`Network error: ${e.message}`));
					break;
				}
				case "voiceforge": {
						let a = await voiceForgeGenerateSpeech(text, voice.arg);
						resolve(await fileUtil.convertToMp3(a, "wav"));
					break;
				}
				case "watson": {
					const hexstring = crypto.randomBytes(16).toString("hex");
					const uuid = hexstring.substring(0,8) + "-" + hexstring.substring(8,12) + "-" + hexstring.substring(12,16) + "-" + hexstring.substring(16,20) + "-" + hexstring.substring(20);
					let req1 = https.request(
						{
							hostname: "tts-frontend.1poue1l648rk.us-east.codeengine.appdomain.cloud",
							path: "/api/tts/session",
							method: "POST",
							headers: {
								origin: "https://www.ibm.com",
								referer: "https://www.ibm.com/"
							},
						},
						(r1) => {
							let buffers = [];
							r1.on("data", (b) => buffers.push(b));
							r1.on("end", () => {
								const cookie = r1.headers["set-cookie"];
								let req2 = https.request(
									{
										hostname: "tts-frontend.1poue1l648rk.us-east.codeengine.appdomain.cloud",
										path: "/api/tts/store",
										method: "POST",
										headers: {
											origin: "https://www.ibm.com",
											referer: "https://www.ibm.com/",
											"Content-Type": "application/json",
											cookie: cookie
										},
									},
									(r2) => {
										let buffers = [];
										r2.on("data", (d) => buffers.push(d));
										r2.on("end", () => {
											const q = new URLSearchParams({
												voice: voice.arg,
												rate_percentage: 0,
												pitch_percentage: 0,
												id: uuid
											}).toString();
											let req3 = https.request(
												{
													hostname: "tts-frontend.1poue1l648rk.us-east.codeengine.appdomain.cloud",
													path: `/api/tts/newSynthesizer?${q}`,
													method: "GET",
													headers: {
														origin: "https://www.ibm.com",
														referer: "https://www.ibm.com/",
														cookie: cookie
													}
												},
												(r3) => {
													r3.on("error", reject);
													resolve(r3);
												}
											).on("error", reject);
											req3.end();
										});
										r2.on("error", reject);
									}
								).on("error", reject);
								req2.end(JSON.stringify({
									sessionID: uuid,
									text
								}));
							});
						}
					).on("error", reject);
					req1.end();
					break;
				}
				default: {
					return reject("Not implemented");
				}
			}
		} catch (e) {
			return reject(e);
		}
	});
};
