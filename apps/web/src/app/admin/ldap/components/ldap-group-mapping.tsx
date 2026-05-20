"use client";

import { ExternalLink, Info, Layers } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LdapGroupMappingProps } from "../types";

export function LdapGroupMapping({ groups, isLoading }: LdapGroupMappingProps) {
  const t = useTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{t("ldap.groupMapping.title")}</CardTitle>
              <CardDescription>{t("ldap.groupMapping.description")}</CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/groups-management">
              {t("ldap.groupMapping.manageGroups")}
              <ExternalLink className="ml-2 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : groups.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
            <Info className="h-4 w-4 text-blue-600" />
            <span className="text-sm">{t("ldap.groupMapping.noMapping")}</span>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ldap.groupMapping.groupName")}</TableHead>
                <TableHead>{t("ldap.groupMapping.adGroupDn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {group.ldapDn}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
