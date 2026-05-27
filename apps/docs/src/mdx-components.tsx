import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { KeyGenerator } from "@/components/KeyGenerator";
import { OIDCProviderCards } from "@/components/OIDCProviderCards";
import { Card, CardGrid } from "@/components/ui/card";
import { Mermaid } from "@/components/ui/mermaid";
import {
  Pipeline,
  PipelineArrow,
  PipelineFork,
  PipelineForkBranch,
  PipelineParallel,
  PipelineParallelItem,
  PipelineStep,
  PipelineTriggers,
} from "@/components/ui/pipeline";

// use this function to get MDX components, you will need it for rendering MDX
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    KeyGenerator,
    OIDCProviderCards,
    Card,
    CardGrid,
    Mermaid,
    Pipeline,
    PipelineArrow,
    PipelineFork,
    PipelineForkBranch,
    PipelineParallel,
    PipelineParallelItem,
    PipelineStep,
    PipelineTriggers,
    ...components,
  };
}
