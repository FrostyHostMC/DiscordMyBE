import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nativeInspectionPlugin } from "./native-inspection-plugin.js";
import { ragekitPlugin } from "./ragekit-plugin.js";
import { sevenZipPlugin } from "./sevenzip-plugin.js";
export default defineConfig({plugins:[react(),nativeInspectionPlugin(),ragekitPlugin(),sevenZipPlugin()],root:".",build:{outDir:"dist",emptyOutDir:true}});
