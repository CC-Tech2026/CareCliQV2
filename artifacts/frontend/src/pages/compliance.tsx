import { useGetComplianceOverview, useGetComplianceReport } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, AlertTriangle, FileCheck2, Info, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";

export default function Compliance() {
  const { data: overview, isLoading: overviewLoading } = useGetComplianceOverview();
  const { data: report, isLoading: reportLoading } = useGetComplianceReport();

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-amber-500";
    return "text-destructive";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Compliance Center</h1>
        <p className="text-slate-500 dark:text-slate-400">Monitor NDIS documentation compliance and audit readiness.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-center items-center py-8">
          <CardHeader className="text-center pb-2 w-full">
            <CardTitle className="text-sm font-medium text-slate-500 uppercase tracking-wider">Overall Score</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center pt-0">
            {overviewLoading ? (
              <Skeleton className="h-32 w-32 rounded-full" />
            ) : (
              <div className="relative flex items-center justify-center mt-4 mb-2">
                <svg className="w-36 h-36 transform -rotate-90">
                  <circle cx="72" cy="72" r="60" stroke="currentColor" strokeWidth="12" fill="transparent" className="text-slate-100 dark:text-slate-800" />
                  <circle 
                    cx="72" cy="72" r="60" 
                    stroke="currentColor" 
                    strokeWidth="12" 
                    fill="transparent" 
                    strokeDasharray={2 * Math.PI * 60} 
                    strokeDashoffset={2 * Math.PI * 60 * (1 - (overview?.average_score || 0) / 100)}
                    className={getScoreColor(overview?.average_score || 0)} 
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute flex flex-col items-center justify-center">
                  <span className={`text-4xl font-bold ${getScoreColor(overview?.average_score || 0)}`}>
                    {Math.round(overview?.average_score || 0)}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">/ 100</span>
                </div>
              </div>
            )}
            <p className="text-sm text-slate-500 mt-4 flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" /> +2% from last month
            </p>
          </CardContent>
        </Card>

        <div className="md:col-span-2 grid gap-4 grid-cols-2">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-emerald-500" /> Compliant Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overviewLoading ? <Skeleton className="h-10 w-16" /> : (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{overview?.compliant || 0}</span>
                  <span className="text-sm text-slate-500">sessions</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Needs Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overviewLoading ? <Skeleton className="h-10 w-16" /> : (
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{overview?.non_compliant || 0}</span>
                  <span className="text-sm text-slate-500">sessions</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="shadow-sm col-span-2 bg-slate-50 dark:bg-slate-900/50">
            <CardContent className="p-4 flex items-start gap-3">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">NDIS Audit Readiness</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Scores above 80% indicate strong compliance with NDIS documentation requirements. Ensure all sessions link directly to participant goals and include measurable outcomes.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Session Audit Log</CardTitle>
          <CardDescription>Detailed compliance breakdown by session</CardDescription>
        </CardHeader>
        <CardContent>
          {reportLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !report || report.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No session data available for audit</div>
          ) : (
            <div className="rounded-md border border-slate-200 dark:border-slate-800">
              <Table>
                <TableHeader className="bg-slate-50 dark:bg-slate-900/50">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead>Checklist</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.map((item) => (
                    <TableRow key={item.session_id}>
                      <TableCell className="text-sm font-medium whitespace-nowrap">
                        {format(parseISO(item.session_date), 'MMM dd, yyyy')}
                      </TableCell>
                      <TableCell className="text-sm">{item.participant_name}</TableCell>
                      <TableCell className="text-sm text-slate-500">{item.session_type}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={`border-transparent font-bold ${
                          item.compliance_score >= 80 ? "bg-emerald-100 text-emerald-800" :
                          item.compliance_score >= 60 ? "bg-amber-100 text-amber-800" :
                          "bg-destructive/10 text-destructive"
                        }`}>
                          {item.compliance_score}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {item.checks?.notes_present ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Notes present" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-destructive" aria-label="Missing notes" />
                          )}
                          {item.checks?.duration_recorded ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Duration recorded" />
                          ) : (
                            <ShieldAlert className="h-4 w-4 text-destructive" aria-label="Missing duration" />
                          )}
                          {item.checks?.goals_linked ? (
                            <ShieldCheck className="h-4 w-4 text-emerald-500" aria-label="Goals linked" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-amber-500" aria-label="Missing goals" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/sessions/${item.session_id}`}>
                          <span className="text-sm text-primary hover:underline cursor-pointer">Review</span>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}