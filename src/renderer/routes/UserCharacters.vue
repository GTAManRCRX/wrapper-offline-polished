<style>
#cc_object[src*="cc.swf"],
#cc_object[src*="cc_browser.swf"] {
	position: fixed;
	top: 40px;
	bottom: 0;
	max-height: calc(100vh - 80px);
	margin-top: auto;
	margin-bottom: auto;
	padding: 0;
	left: 50%;
	transform: translateX(-37%) scale(clamp(0.3, (0.001143 * var(--win-w)) - 0.5617, 0.9));
}
#cc_object[src*="cc_browser.swf"] {
	height: min(80vh, calc(100vh - 80px));
}
.cc_popup_container #cc_object[src*="cc.swf"],
.cc_popup_container #cc_object[src*="cc_browser.swf"] {
	position: relative;
	top: 0;
	bottom: auto;
	max-height: none;
	left: auto;
	transform: none;
	margin: 40px auto;
}
</style>
<script setup lang="ts">
import CCObject from "../components/CCObject.vue";
import Navbar, { NavbarEntry } from "../components/Navbar.vue";
import { onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { onMounted, Ref, ref, useTemplateRef } from "vue";
import ThemeSelector from "../components/ThemeSelector.vue";
import useTempStorage from "../composables/useTempStorage";
import { useThemeList } from "../composables/useThemeList";

type CCObjectType = InstanceType<typeof CCObject>;

const ccObject = useTemplateRef<CCObjectType>("cc-object");
const route = useRoute();
const router = useRouter();
const tempStorage = useTempStorage();

const baseNavbarEntry = {
	path: "/characters",
	title: "Characters"
};
const navbarEntries:Ref<NavbarEntry[]> = ref([]);
const showDlButton = ref(false);
const showObject = ref(false);
const showSelector = ref(false);
let themeId = "";

const updateVW = () => document.documentElement.style.setProperty('--win-w', window.innerWidth);
window.addEventListener('resize', updateVW); updateVW();

function initObject(id:string) {
	themeId = id;
	showSelector.value = false;
	showObject.value = true;
	const xml = tempStorage.retrieve("charXmlData") as string | void;
	if (typeof xml != "undefined") {
		ccObject.value.uploadCharacter(themeId, xml);
		return;
	}
	ccObject.value.displayBrowser(themeId);
}

function ccEntered() {
	navbarEntries.value.push({
		path: "hope you like it",
		title: "Creating a character"
	});
	showDlButton.value = true;
}

function charDownload() {
	const xml = ccObject.value.getXml();
	const elem = document.createElement("a");
	elem.href = "data:text/xml," + xml;
	elem.download = "character.xml";
	elem.click();
	elem.remove();
}

function charSaved() {
	populateNavbar();
	ccObject.value.displayBrowser(themeId);
}

function themeIdCheck() {
	if (themeId.length > 0) {
		populateNavbar();
		initObject(themeId);
	} else {
		showSelector.value = true;
		showObject.value = false;
	}
}

async function populateNavbar() {
	const themeList = await useThemeList();
	const theme = themeList.find(t => t.cc_theme_id == themeId);
	navbarEntries.value = [
		baseNavbarEntry,
		{
			path: "/characters/",
			title: `${theme.name} characters`
		}
	];
	showDlButton.value = false;
}

function themeClicked(id:string) {
	router.push({
		name: "cc_page",
		params: {
			themeId: id
		}
	});
}

onBeforeRouteUpdate((newRoute) => {
	ccObject.value.reset();
	themeId = newRoute.params.themeId as string || "";
	themeIdCheck();
});

onMounted(() => {
	themeId = route.params.themeId as string || "";
	themeIdCheck();
});
</script>

<template>
	<div>
		<Navbar
			:entries="navbarEntries"
			:supported="{ download:showDlButton }"
			state="cc"
			@download-click="charDownload"/>
		<div class="page_contents">
			<theme-selector
				heading-for="Characters"
				v-if="showSelector"
				cc-filter
				@theme-clicked="(theme) => themeClicked(theme.cc_theme_id)"/>
			<CCObject v-show="showObject" ref="cc-object" @cc-enter="ccEntered" @char-saved="charSaved"/>
		</div>
	</div>
</template>
