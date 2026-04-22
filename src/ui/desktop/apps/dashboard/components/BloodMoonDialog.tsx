import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BloodMoonDialogProps {
  hostName: string;
  open: boolean;
  onDelete: () => void;
  onDismiss: () => void;
}

export function BloodMoonDialog({
  hostName,
  open,
  onDelete,
  onDismiss,
}: BloodMoonDialogProps): React.ReactElement {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Blood Moon</AlertDialogTitle>
          <AlertDialogDescription>
            Node {hostName} hasn't been seen in a blood moon. Delete node?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDismiss}>Keep</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
