import type { LucideIcon } from "lucide-react";
import {
  Atom,
  BookOpen,
  Braces,
  Bug,
  Cloud,
  Code,
  Database,
  File,
  FileArchive,
  FileCode,
  FileCode2,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileType2,
  Image,
  Key,
  Lock,
  Monitor,
  Palette,
  Presentation,
  Settings,
  Sigma,
  SquareTerminal,
  Video,
  Wrench,
} from "lucide-react";
import type { ComponentType, SVGAttributes } from "react";
import {
  TbBrandCss3,
  TbBrandDocker,
  TbBrandGit,
  TbBrandGolang,
  TbBrandHtml5,
  TbBrandJavascript,
  TbBrandKotlin,
  TbBrandNpm,
  TbBrandPhp,
  TbBrandPython,
  TbBrandReact,
  TbBrandRust,
  TbBrandSass,
  TbBrandSwift,
  TbBrandTypescript,
  TbBrandVue,
  TbBrandYarn,
} from "react-icons/tb";

type FileIconComponent = LucideIcon | ComponentType<SVGAttributes<SVGSVGElement>>;

interface FileIconMapping {
  extensions: string[];
  icon: FileIconComponent;
  color: string;
}

const fileIcons: FileIconMapping[] = [
  // Images
  {
    extensions: ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "ico", "heic", "avif"],
    icon: Image,
    color: "text-blue-500",
  },

  // Documents
  {
    extensions: ["pdf"],
    icon: FileType2,
    color: "text-red-500",
  },
  {
    extensions: ["doc", "docx", "odt", "rtf"],
    icon: FileText,
    color: "text-blue-600",
  },
  {
    extensions: ["xls", "xlsx", "ods", "csv"],
    icon: FileSpreadsheet,
    color: "text-green-600",
  },
  {
    extensions: ["ppt", "pptx", "odp"],
    icon: Presentation,
    color: "text-orange-500",
  },

  // Media
  {
    extensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "wma", "opus"],
    icon: FileMusic,
    color: "text-purple-500",
  },
  {
    extensions: ["mp4", "avi", "mov", "wmv", "mkv", "webm", "flv", "m4v", "3gp"],
    icon: Video,
    color: "text-pink-500",
  },

  // Archives
  {
    extensions: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "lz", "cab", "deb", "rpm"],
    icon: FileArchive,
    color: "text-yellow-600",
  },

  // JavaScript/TypeScript
  {
    extensions: ["js", "mjs", "cjs"],
    icon: TbBrandJavascript,
    color: "text-yellow-500",
  },
  {
    extensions: ["ts", "tsx"],
    icon: TbBrandTypescript,
    color: "text-blue-600",
  },
  {
    extensions: ["jsx"],
    icon: TbBrandReact,
    color: "text-cyan-500",
  },
  {
    extensions: ["vue"],
    icon: TbBrandVue,
    color: "text-green-500",
  },

  // Web Technologies
  {
    extensions: ["html", "htm", "xhtml"],
    icon: TbBrandHtml5,
    color: "text-orange-600",
  },
  {
    extensions: ["css"],
    icon: TbBrandCss3,
    color: "text-blue-600",
  },
  {
    extensions: ["scss", "sass"],
    icon: TbBrandSass,
    color: "text-pink-600",
  },
  {
    extensions: ["less", "stylus"],
    icon: Palette,
    color: "text-purple-600",
  },

  // Programming Languages
  {
    extensions: ["py", "pyw", "pyc", "pyo", "pyd"],
    icon: TbBrandPython,
    color: "text-yellow-600",
  },
  {
    extensions: ["php", "phtml"],
    icon: TbBrandPhp,
    color: "text-purple-700",
  },
  {
    extensions: ["go"],
    icon: TbBrandGolang,
    color: "text-cyan-600",
  },
  {
    extensions: ["rs"],
    icon: TbBrandRust,
    color: "text-orange-700",
  },
  {
    extensions: ["swift"],
    icon: TbBrandSwift,
    color: "text-orange-500",
  },
  {
    extensions: ["kt", "kts"],
    icon: TbBrandKotlin,
    color: "text-purple-600",
  },
  {
    extensions: ["java", "class", "jar"],
    icon: Code,
    color: "text-red-600",
  },
  {
    extensions: ["c", "h"],
    icon: Code,
    color: "text-blue-700",
  },
  {
    extensions: ["cpp", "cxx", "cc", "hpp", "hxx"],
    icon: Code,
    color: "text-blue-800",
  },
  {
    extensions: ["cs"],
    icon: Code,
    color: "text-purple-700",
  },
  {
    extensions: ["rb", "rbw", "rake"],
    icon: Code,
    color: "text-red-500",
  },
  {
    extensions: ["scala", "sc"],
    icon: Code,
    color: "text-red-700",
  },
  {
    extensions: ["clj", "cljs", "cljc", "edn"],
    icon: Code,
    color: "text-green-700",
  },
  {
    extensions: ["hs", "lhs"],
    icon: Code,
    color: "text-purple-800",
  },
  {
    extensions: ["elm"],
    icon: Code,
    color: "text-blue-700",
  },
  {
    extensions: ["dart"],
    icon: Code,
    color: "text-blue-600",
  },
  {
    extensions: ["lua"],
    icon: Code,
    color: "text-blue-800",
  },
  {
    extensions: ["r", "rmd"],
    icon: Sigma,
    color: "text-blue-700",
  },
  {
    extensions: ["matlab", "m"],
    icon: Sigma,
    color: "text-orange-600",
  },
  {
    extensions: ["julia", "jl"],
    icon: Sigma,
    color: "text-purple-600",
  },

  // Shell Scripts
  {
    extensions: ["sh", "bash", "zsh", "fish"],
    icon: SquareTerminal,
    color: "text-green-600",
  },
  {
    extensions: ["ps1", "psm1", "psd1"],
    icon: SquareTerminal,
    color: "text-blue-700",
  },
  {
    extensions: ["bat", "cmd"],
    icon: SquareTerminal,
    color: "text-gray-600",
  },

  // Database
  {
    extensions: ["sql", "mysql", "pgsql", "sqlite", "db"],
    icon: Database,
    color: "text-blue-700",
  },

  // Configuration Files
  {
    extensions: ["json", "json5"],
    icon: Code,
    color: "text-yellow-700",
  },
  {
    extensions: ["yaml", "yml"],
    icon: Settings,
    color: "text-purple-600",
  },
  {
    extensions: ["toml"],
    icon: Settings,
    color: "text-orange-600",
  },
  {
    extensions: ["xml", "xsd", "xsl", "xslt"],
    icon: Code,
    color: "text-orange-700",
  },
  {
    extensions: ["ini", "cfg", "conf", "config"],
    icon: Settings,
    color: "text-gray-600",
  },
  {
    extensions: ["env", "dotenv"],
    icon: Key,
    color: "text-green-700",
  },
  {
    extensions: ["properties"],
    icon: Settings,
    color: "text-blue-600",
  },

  // Docker & DevOps
  {
    extensions: ["dockerfile", "containerfile"],
    icon: TbBrandDocker,
    color: "text-blue-600",
  },
  {
    extensions: ["tf", "tfvars", "hcl"],
    icon: Cloud,
    color: "text-purple-600",
  },
  {
    extensions: ["k8s", "kubernetes"],
    icon: Cloud,
    color: "text-blue-700",
  },
  {
    extensions: ["ansible", "playbook"],
    icon: Wrench,
    color: "text-red-600",
  },

  // Package Managers
  {
    extensions: ["package"],
    icon: TbBrandNpm,
    color: "text-red-600",
  },
  {
    extensions: ["yarn"],
    icon: TbBrandYarn,
    color: "text-blue-600",
  },
  {
    extensions: ["cargo"],
    icon: TbBrandRust,
    color: "text-orange-700",
  },
  {
    extensions: ["gemfile"],
    icon: Code,
    color: "text-red-500",
  },
  {
    extensions: ["composer"],
    icon: TbBrandPhp,
    color: "text-purple-700",
  },
  {
    extensions: ["requirements", "pipfile", "poetry"],
    icon: TbBrandPython,
    color: "text-yellow-600",
  },
  {
    extensions: ["gradle", "build.gradle"],
    icon: Wrench,
    color: "text-green-700",
  },
  {
    extensions: ["pom"],
    icon: Code,
    color: "text-orange-600",
  },
  {
    extensions: ["makefile", "cmake"],
    icon: Wrench,
    color: "text-blue-700",
  },

  // Git
  {
    extensions: ["gitignore", "gitattributes", "gitmodules", "gitconfig"],
    icon: TbBrandGit,
    color: "text-orange-600",
  },

  // Documentation
  {
    extensions: ["md", "markdown"],
    icon: FileCode2,
    color: "text-emerald-500",
  },
  {
    extensions: ["rst", "txt"],
    icon: FileText,
    color: "text-gray-500",
  },
  {
    extensions: ["adoc", "asciidoc"],
    icon: BookOpen,
    color: "text-blue-600",
  },
  {
    extensions: ["tex", "latex"],
    icon: Sigma,
    color: "text-green-700",
  },
  {
    extensions: ["log"],
    icon: Bug,
    color: "text-yellow-600",
  },

  // Templates
  {
    extensions: ["hbs", "handlebars", "mustache"],
    icon: Code,
    color: "text-orange-600",
  },
  {
    extensions: ["twig"],
    icon: Code,
    color: "text-green-600",
  },
  {
    extensions: ["liquid"],
    icon: Code,
    color: "text-blue-600",
  },
  {
    extensions: ["ejs", "pug", "jade"],
    icon: Code,
    color: "text-brown-600",
  },

  // Data Formats
  {
    extensions: ["graphql", "gql"],
    icon: Braces,
    color: "text-pink-600",
  },
  {
    extensions: ["proto", "protobuf"],
    icon: FileCode,
    color: "text-blue-700",
  },

  // Security & Certificates
  {
    extensions: ["pem", "crt", "cer", "key", "p12", "pfx"],
    icon: Lock,
    color: "text-green-800",
  },

  // Web Assembly
  {
    extensions: ["wasm", "wat"],
    icon: Atom,
    color: "text-purple-700",
  },

  // Shaders
  {
    extensions: ["glsl", "hlsl", "vert", "frag", "geom"],
    icon: Monitor,
    color: "text-cyan-700",
  },

  // Specialized
  {
    extensions: ["vim", "vimrc"],
    icon: Code,
    color: "text-green-800",
  },
  {
    extensions: ["eslintrc", "prettierrc", "babelrc"],
    icon: Settings,
    color: "text-yellow-700",
  },
  {
    extensions: ["tsconfig", "jsconfig"],
    icon: Settings,
    color: "text-blue-700",
  },
  {
    extensions: ["webpack", "rollup", "vite"],
    icon: Wrench,
    color: "text-cyan-600",
  },
  {
    extensions: ["lock", "sum"],
    icon: Lock,
    color: "text-gray-600",
  },

  // Fallback for general text/code files
  {
    extensions: ["svelte", "astro", "erb", "haml", "slim"],
    icon: FileCode,
    color: "text-gray-600",
  },
];

export function getFileIcon(filename: string): { icon: FileIconComponent; color: string } {
  const extension = filename.split(".").pop()?.toLowerCase() || "";

  const mapping = fileIcons.find((type) => type.extensions.includes(extension));

  return mapping || { icon: File, color: "text-gray-400" };
}
