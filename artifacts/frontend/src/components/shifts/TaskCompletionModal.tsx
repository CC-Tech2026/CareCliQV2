import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Upload, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { jsonFetch } from "@/services/http";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  instanceId: string;
  onSuccess: () => void;
};

export function TaskCompletionModal({ isOpen, onClose, instanceId, onSuccess }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");

  // Fetch task instance and template to get evidence requirements
  const { data: instanceData, isLoading: isLoadingInstance } = useQuery({
    queryKey: ["tasks", "instances", instanceId],
    queryFn: async () => {
      // This would need an endpoint to fetch instance details with template info
      // For now, we'll handle it in the mutation
      return null;
    },
    enabled: isOpen,
  });

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: async () => {
      // Upload photo if provided
      let photoUrl: string | null = null;
      if (photoFile) {
        const formData = new FormData();
        formData.append("file", photoFile);
        try {
          const uploadedData = await jsonFetch<{ url: string }>("/api/upload", {
            method: "POST",
            body: formData,
          });
          photoUrl = uploadedData.url;
        } catch (error) {
          console.error("Photo upload failed:", error);
          toast({
            title: "Photo upload failed",
            description: "Photo will not be attached to this task.",
            variant: "destructive",
          });
        }
      }

      const payload = {
        completed_by: user?.id,
        evidence_photo_url: photoUrl,
        evidence_notes: notes,
        completion_notes: completionNotes,
      };

      const response = await jsonFetch<{ missing_evidence?: string[] }>(`/api/tasks/instances/${instanceId}/complete`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      // Check if response has missing_evidence (validation error)
      if (response.missing_evidence) {
        const missingList = response.missing_evidence.join(", ");
        throw new Error(`Missing evidence: ${missingList}`);
      }

      return response;
    },
    onSuccess: () => {
      toast({
        title: "Task completed",
        description: "Task marked as complete with evidence captured.",
      });
      setPhotoPreview(null);
      setPhotoFile(null);
      setNotes("");
      setCompletionNotes("");
      onSuccess();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error completing task",
        description: error.message || "Failed to complete task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onload = (event) => {
        setPhotoPreview(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  const handleClose = () => {
    if (!completeTaskMutation.isPending) {
      setPhotoPreview(null);
      setPhotoFile(null);
      setNotes("");
      setCompletionNotes("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Photo Evidence */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Photo Evidence
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Take or upload a photo showing task completion
            </p>

            {photoPreview ? (
              <div className="relative mt-2">
                <img
                  src={photoPreview}
                  alt="Evidence photo"
                  className="h-40 w-full rounded border border-gray-300 object-cover"
                />
                <button
                  onClick={handleRemovePhoto}
                  className="absolute -right-2 -top-2 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                  title="Remove photo"
                  aria-label="Remove evidence photo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 px-4 py-6 text-center hover:border-gray-400">
                <Upload className="h-6 w-6 text-gray-400" />
                <span className="mt-2 text-sm text-gray-600">
                  Click to upload or drag and drop
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                  disabled={completeTaskMutation.isPending}
                />
              </label>
            )}
          </div>

          {/* Evidence Notes */}
          <div>
            <label htmlFor="evidence-notes" className="block text-sm font-medium text-gray-700">
              Evidence Notes
            </label>
            <Textarea
              id="evidence-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe what was done, any observations, etc."
              className="mt-1"
              rows={3}
              disabled={completeTaskMutation.isPending}
            />
          </div>

          {/* Completion Notes (optional) */}
          <div>
            <label htmlFor="completion-notes" className="block text-sm font-medium text-gray-700">
              Completion Notes (optional)
            </label>
            <Textarea
              id="completion-notes"
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Any additional notes for the coordinator..."
              className="mt-1"
              rows={2}
              disabled={completeTaskMutation.isPending}
            />
          </div>

          {/* Info Box */}
          <div className="rounded bg-blue-50 p-3 text-xs text-blue-700">
            <strong>Note:</strong> This task will be marked as completed and cannot be edited. Make
            sure all evidence is captured before submitting.
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 py-4">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={completeTaskMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => completeTaskMutation.mutate()}
            disabled={completeTaskMutation.isPending}
          >
            {completeTaskMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Complete Task
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
