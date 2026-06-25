"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DynamicIcon } from "@/components/ui/dynamic-icon";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { IconEntry } from "./icon-grid";
import { VirtualizedIconGrid } from "./icon-grid";
import { ICON_PACKS, TOTAL_ICON_COUNT, getPackForIcon } from "./icon-metadata";

interface IconPickerProps {
  value?: string;
  onChange: (iconName: string) => void;
  placeholder?: string;
}

/** Curated list of popular icons for the "Popular" tab */
const POPULAR_ICONS = [
  "FaGoogle",
  "FaGithub",
  "FaMicrosoft",
  "FaApple",
  "FaAmazon",
  "FaFacebook",
  "FaTwitter",
  "FaLinkedin",
  "FaDiscord",
  "FaSlack",
  "FaLock",
  "FaShield",
  "FaKey",
  "FaUser",
  "FaUsers",
  "FaCloud",
  "FaDatabase",
  "FaServer",
  "FaCog",
  "FaTools",
  "SiGoogle",
  "SiGithub",
  "SiMicrosoft",
  "SiAuth0",
  "SiOkta",
  "BsShield",
  "HiUser",
  "MdSecurity",
  "RiLockLine",
  "TbKey",
];

/** Curated list of auth provider icons for the "Auth" tab */
const AUTH_PROVIDER_ICONS = [
  "SiGoogle",
  "SiGithub",
  "SiMicrosoft",
  "SiAuth0",
  "SiOkta",
  "SiKeycloak",
  "SiAzuredevops",
  "FaShieldAlt",
  "FaLock",
  "FaKey",
  "FaUserShield",
  "FaIdCard",
  "FaFingerprint",
  "FaUserCheck",
  "BsShieldCheck",
  "HiShieldCheck",
  "MdSecurity",
  "RiLockPasswordLine",
  "TbShieldCheck",
  "AiOutlineSecurityScan",
];

/** Build IconEntry from a list of known icon names */
function buildEntries(iconNames: string[]): IconEntry[] {
  return iconNames
    .map((name) => {
      const slug = getPackForIcon(name);
      if (!slug) return null;
      const pack = ICON_PACKS.find((p) => p.slug === slug);
      return { name, packSlug: slug, category: pack?.category ?? slug } satisfies IconEntry;
    })
    .filter((entry): entry is IconEntry => entry !== null);
}

/** All icon entries (computed once) */
const ALL_ENTRIES: IconEntry[] = ICON_PACKS.flatMap((pack) =>
  [...pack.icons].map((name) => ({
    name,
    packSlug: pack.slug,
    category: pack.category,
  })),
);

export function IconPicker({ value, onChange, placeholder }: IconPickerProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const displayPlaceholder = placeholder || t("iconPicker.placeholder");

  const filteredEntries = useMemo(() => {
    if (!search) return ALL_ENTRIES;
    const lower = search.toLowerCase();
    return ALL_ENTRIES.filter((entry) => entry.name.toLowerCase().includes(lower));
  }, [search]);

  const popularEntries = useMemo(() => buildEntries(POPULAR_ICONS), []);
  const authEntries = useMemo(() => buildEntries(AUTH_PROVIDER_ICONS), []);

  const categories = useMemo(() => {
    const unique = new Set(ICON_PACKS.map((p) => p.category));
    return Array.from(unique).sort();
  }, []);

  const handleIconSelect = useCallback(
    (iconName: string) => {
      onChange(iconName);
      setOpen(false);
      setSearch("");
    },
    [onChange],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full justify-between">
          <div className="flex items-center gap-2">
            {value ? (
              <>
                <DynamicIcon name={value} className="h-[18px] w-[18px]" />
                <span className="text-sm">{value}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{displayPlaceholder}</span>
            )}
          </div>
          <ChevronDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl xl:max-w-6xl max-h-[90vh] overflow-hidden">
        <div className="space-y-4 overflow-hidden">
          <div className="flex items-center justify-between">
            <DialogTitle>{t("iconPicker.title")}</DialogTitle>
            <div className="text-sm text-muted-foreground">
              {t("iconPicker.stats", {
                iconCount: TOTAL_ICON_COUNT.toLocaleString(),
                libraryCount: categories.length,
              })}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("iconPicker.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-8"
            />
            {search && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute end-1 top-1 h-6 w-6 p-0"
                onClick={() => setSearch("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          <Tabs defaultValue="all" className="w-full overflow-hidden">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="all">{t("iconPicker.tabs.all")}</TabsTrigger>
              <TabsTrigger value="popular">{t("iconPicker.tabs.popular")}</TabsTrigger>
              <TabsTrigger value="auth">{t("iconPicker.tabs.auth")}</TabsTrigger>
            </TabsList>

            {/* All Icons */}
            <TabsContent value="all" className="mt-4 overflow-hidden">
              {search ? (
                <VirtualizedIconGrid
                  key={`search-${search}`}
                  entries={filteredEntries}
                  onIconSelect={handleIconSelect}
                  showCategories={false}
                />
              ) : (
                <VirtualizedIconGrid
                  key="categories"
                  entries={ALL_ENTRIES}
                  onIconSelect={handleIconSelect}
                  showCategories={true}
                />
              )}
            </TabsContent>

            {/* Popular Icons */}
            <TabsContent value="popular" className="mt-4 overflow-hidden">
              <VirtualizedIconGrid key="popular" entries={popularEntries} onIconSelect={handleIconSelect} />
            </TabsContent>

            {/* Auth Provider Icons */}
            <TabsContent value="auth" className="mt-4 overflow-hidden">
              <VirtualizedIconGrid key="auth" entries={authEntries} onIconSelect={handleIconSelect} />
            </TabsContent>
          </Tabs>

          {search && filteredEntries.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="mx-auto h-12 w-12 opacity-50 mb-2" />
              <p>{t("iconPicker.noIconsFound", { search })}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
