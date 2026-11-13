import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nativeInspectionPlugin } from "./native-inspection-plugin.js";
export default defineConfig({plugins:[react(),nativeInspectionPlugin()],root:".",build:{outDir:"dist",emptyOutDir:true}});
