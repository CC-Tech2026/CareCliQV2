import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useGetSession, useUpdateSession, useSaveSessionWithAI } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, Activity, FileText, CheckCircle2, ShieldAlert, Sparkles, Loader2, Brain, AlertTriangle, Upload, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function SessionDetail({ id }: { id?: string }) {
  const { id: paramId } = useParams();
  const sessionId = id || paramId;
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: session, isLoading, refetch } = useGetSession(sessionId as string, { 
    query: { enabled: !!sessionId, queryKey: ['getSession', sessionId] } 
  });
  
  const updateSession = useUpdateSession();
  const saveWithAI = useSaveSessionWithAI();

  const [notes, setNotes] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (session && !isEditing) {
      setNotes(session.notes || "");
    }
  }, [session, isEditing]);

  const handleSaveNotes = () => {
    if (!sessionId) return;
    
    updateSession.mutate({
      sessionId,
      data: { notes }
    }, {
      onSuccess: () => {
        toast({ title: "Notes saved successfully" });
        setIsEditing(false);
        refetch();
      }
    });
  };

  const handleAIAnalysis = () => {
    if (!sessionId) return;

    saveWithAI.mutate({ sessionId }, {
      onSuccess: () => {
        toast({ title: "AI Analysis complete", description: "Compliance score and insights updated." });
        refetch();
      },
      onError: () => {
        toast({ title: "AI Analysis failed", variant: "destructive" });
      }
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Simulate file upload
    setIsUploading(true);
    setTimeout(() => {
      toast({ title: "Photo uploaded successfully", description: file.name });
      setIsUploading(false);
      // In a real app, we would update the session with the new photo URL here
    }, 1500);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!session) return <div>Session not found</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {session.participants?.full_name || 'Session'}
            </h1>
            {session.status === 'draft' && <Badge variant="outline" className="bg-amber-50 text-amber-700">Draft</Badge>}
            {session.status === 'completed' && <Badge variant="outline" className="bg-slate-100 text-slate-700">Completed</Badge>}
          </div>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> {session.session_date ? format(parseISO(session.session_date), 'MMMM d, yyyy') : ''}</span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {session.duration_minutes} min</span>
            <span className="flex items-center gap-1.5"><Activity className="h-4 w-4" /> {session.session_type}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/patients`}>
            <Button variant="outline">View Patient</Button>
          </Link>
          <Button 
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white" 
            onClick={handleAIAnalysis}
            disabled={saveWithAI.isPending}
            data-testid="button-ai-analyze"
          >
            {saveWithAI.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyze Compliance
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" /> Clinical Notes
              </CardTitle>
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>Edit</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setIsEditing(false); setNotes(session.notes || ""); }}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveNotes} disabled={updateSession.isPending}>Save</Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-6">
              {isEditing ? (
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[300px] text-base leading-relaxed resize-y"
                  placeholder="Enter clinical notes here..."
                />
              ) : (
                <div className="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed">
                  {session.notes ? (
                    <div className="whitespace-pre-wrap">{session.notes}</div>
                  ) : (
                    <p className="text-slate-400 italic">No notes recorded yet.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {session.transcription && (
            <Card className="border-slate-200 shadow-sm bg-slate-50 dark:bg-slate-900/50">
              <CardHeader className="pb-3 border-b border-slate-200/50 dark:border-slate-800/50">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  Audio Transcription
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                  {session.transcription}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className={`border-2 shadow-sm ${
            !session.compliance_score ? 'border-slate-200 dark:border-slate-800' :
            session.compliance_score >= 80 ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30' :
            session.compliance_score >= 60 ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/30' :
            'border-destructive/30 bg-destructive/5'
          }`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Compliance Score</span>
                {session.compliance_score && (
                  <Badge variant="outline" className={`text-base font-bold px-2.5 py-0.5 border-transparent ${
                    session.compliance_score >= 80 ? 'bg-emerald-100 text-emerald-800' :
                    session.compliance_score >= 60 ? 'bg-amber-100 text-amber-800' :
                    'bg-destructive/10 text-destructive'
                  }`}>
                    {session.compliance_score}/100
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!session.compliance_score ? (
                <div className="text-center py-6 text-slate-500">
                  <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Not yet analyzed</p>
                  <Button variant="link" size="sm" onClick={handleAIAnalysis} className="mt-1 h-auto py-0">Run AI Analysis</Button>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      {session.notes && session.notes.length > 50 ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <span className="text-slate-700 dark:text-slate-300">Detailed clinical notes</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      {session.duration_minutes > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <span className="text-slate-700 dark:text-slate-300">Duration recorded</span>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      {session.goals_addressed && session.goals_addressed.length > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                      <span className="text-slate-700 dark:text-slate-300">Linked to NDIS goals</span>
                    </div>
                  </div>
                  {session.compliance_notes && (
                    <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mb-1">Feedback:</p>
                      <p className="text-sm text-slate-700 dark:text-slate-300">{session.compliance_notes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-indigo-100 shadow-sm bg-indigo-50/30 dark:bg-indigo-900/10 dark:border-indigo-900/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-indigo-900 dark:text-indigo-300">
                <Brain className="h-4 w-4" /> AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              {session.ai_insights ? (
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {session.ai_insights}
                </p>
              ) : (
                <p className="text-sm text-slate-500 italic py-4 text-center">
                  Run AI Analysis to generate clinical insights and progress tracking.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Tags & Goals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Tags</p>
                {session.tags && session.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {session.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="font-normal">{tag}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No tags added</p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wider">Goals Addressed</p>
                {session.goals_addressed && session.goals_addressed.length > 0 ? (
                  <ul className="space-y-1">
                    {session.goals_addressed.map((goal, i) => (
                      <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex gap-2">
                        <span className="text-primary">•</span> {goal}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-400">No goals linked</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="h-4 w-4" /> Photos
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span className="sr-only sm:not-sr-only sm:ml-2">Upload</span>
              </Button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileUpload} 
              />
            </CardHeader>
            <CardContent>
              {session.photo_urls && session.photo_urls.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {session.photo_urls.map((url, i) => (
                    <div key={i} className="aspect-square rounded-md bg-slate-100 overflow-hidden border border-slate-200">
                      <img src={url} alt={`Session photo ${i+1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-md border border-dashed border-slate-200 dark:border-slate-800">
                  <ImageIcon className="h-6 w-6 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No photos attached</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}