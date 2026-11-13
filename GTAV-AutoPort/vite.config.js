import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nativeInspectionPlugin } from "./native-inspection-plugin.js";
import { ragekitPlugin } from "./ragekit-plugin.js";
export default defineConfig({plugins:[react(),nativeInspectionPlugin(),ragekitPlugin()],root:".",build:{outDir:"dist",emptyOutDir:true}});
