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
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  open: boolean;
  sizeLabel: string;
  onUploadNow: () => void;
  onWaitForWifi: () => void;
};

export function MobileDataWarningModal({ open, sizeLabel, onUploadNow, onWaitForWifi }: Props) {
  const { translate, translateParams } = useAccessibility();

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{translate("offline.mobileData.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {translateParams("offline.mobileData.description", { size: sizeLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onWaitForWifi}>{translate("offline.mobileData.waitWifi")}</AlertDialogCancel>
          <AlertDialogAction onClick={onUploadNow}>{translate("offline.mobileData.uploadNow")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
