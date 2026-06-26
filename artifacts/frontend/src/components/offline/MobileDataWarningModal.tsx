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

type Props = {
  open: boolean;
  sizeLabel: string;
  onUploadNow: () => void;
  onWaitForWifi: () => void;
};

export function MobileDataWarningModal({ open, sizeLabel, onUploadNow, onWaitForWifi }: Props) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mobile data upload</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;re on mobile data. Uploading {sizeLabel} may use significant data. Upload now or
            wait for Wi-Fi?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onWaitForWifi}>Wait for Wi-Fi</AlertDialogCancel>
          <AlertDialogAction onClick={onUploadNow}>Upload now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
