import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Layers, Trash2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listUsers } from "@/http/endpoints";
import { formatBytes } from "@/lib/format-bytes";
import { queryKeys } from "@/lib/query-keys";
import type { GroupDetailModalProps } from "../types";

export function GroupDetailModal({
  isOpen,
  onClose,
  group,
  isLoading,
  onAddMember,
  onRemoveMember,
}: GroupDetailModalProps) {
  const t = useTranslations();
  const [selectedUserId, setSelectedUserId] = useState<string>("");

  const usersQuery = useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: async () => {
      const response = await listUsers();
      return response.data;
    },
    enabled: isOpen,
  });

  const allUsers = usersQuery.data ?? [];
  const memberIds = new Set(group?.members.map((m) => m.id) ?? []);

  // Users not already in this group
  const availableUsers = allUsers.filter((u) => !memberIds.has(u.id));

  const handleAddMember = () => {
    if (!selectedUserId) return;
    onAddMember(selectedUserId);
    setSelectedUserId("");
  };

  // Find if selected user belongs to another group
  const selectedUserData = selectedUserId ? allUsers.find((u) => u.id === selectedUserId) : null;
  const selectedUserInOtherGroup =
    selectedUserData?.groupId && selectedUserData.groupId !== group?.id;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 mb-2">
            <Layers className="size-6 me-1" />
            {group?.name ?? t("groups.detail.title")}
          </DialogTitle>
        </DialogHeader>

        {isLoading || !group ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {group.description && (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            )}

            <Separator />

            {/* Members table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">
                  {t("groups.detail.members")}{" "}
                  <Badge variant="secondary" className="ml-1">
                    {group.members.length}
                  </Badge>
                </Label>
              </div>

              {group.members.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b-0">
                        <TableHead className="h-9 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                          {t("groups.detail.memberUser")}
                        </TableHead>
                        <TableHead className="h-9 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                          {t("groups.detail.memberEmail")}
                        </TableHead>
                        <TableHead className="h-9 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                          {t("groups.detail.memberStorage")}
                        </TableHead>
                        <TableHead className="h-9 w-[60px] text-xs font-bold text-muted-foreground bg-muted/50 px-4" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.members.map((member) => (
                        <TableRow
                          key={member.id}
                          className="hover:bg-muted/50 transition-colors border-0"
                        >
                          <TableCell className="h-10 px-4">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={member.image || ""} alt={member.username} />
                                <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                                  {member.firstName?.charAt(0) ??
                                    member.username[0]?.toUpperCase() ??
                                    "?"}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-sm">{member.username}</span>
                            </div>
                          </TableCell>
                          <TableCell className="h-10 px-4 text-sm">{member.email}</TableCell>
                          <TableCell className="h-10 px-4 text-sm">
                            {formatBytes(member.storageUsed)}
                          </TableCell>
                          <TableCell className="h-10 px-4">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => onRemoveMember(member.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("groups.detail.noMembers")}
                </p>
              )}
            </div>

            <Separator />

            {/* Add member section */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium">{t("groups.detail.addMember")}</Label>
              <div className="flex gap-2">
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("groups.detail.selectUser")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.username} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleAddMember} disabled={!selectedUserId}>
                  <UserPlus className="h-4 w-4" />
                  {t("groups.detail.add")}
                </Button>
              </div>

              {selectedUserInOtherGroup && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {t("groups.detail.userInOtherGroup", {
                      groupName: selectedUserData?.groupName ?? "",
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
