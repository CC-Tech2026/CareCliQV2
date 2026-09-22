# Security Penetration Test Report

**Generated:** 2026-08-25 06:38:16 UTC

# Executive Summary

A comprehensive white-box security assessment was conducted on CareCliQV2, a multi-tenant healthcare NDIS support coordination platform handling Protected Health Information. The assessment identified 7 confirmed vulnerabilities including 2 CRITICAL issues enabling complete database compromise and authentication bypass.

Overall Security Posture: CRITICAL

CRITICAL Severity (2 vulnerabilities - CVSS 10.0):
Production Supabase database credentials exposed in .env.example grant unrestricted admin access to production database containing 25+ users, 2+ organizations, and 45+ shifts of PHI/financial data. Publicly known SESSION_SECRET enables complete JWT forgery, privilege escalation, and multi-tenant isolation bypass across all 554 API endpoints.

HIGH Severity (3 vulnerabilities):
CVE-2025-71329 and CVE-2025-71330 in image-size 1.2.1 cause DoS via crafted images affecting mobile build pipeline. CVE-2024-23342 in python-ecdsa 0.19.2 Minerva timing attack (currently unexploitable with HS256).

MEDIUM Severity (2 vulnerabilities):
GCP API key exposure (CVSS 6.5) with quota exhaustion risk. Session revocation bypass (CVSS 6.5) via optional JTI claim.

Business Impact: Complete PHI exposure, financial data compromise, multi-tenant isolation failure, authentication bypass, Privacy Act 1988 breach notification likely required.

Immediate Actions (within 24 hours): Rotate Supabase credentials, rotate SESSION_SECRET, force global re-authentication, audit database access logs, assess breach notification requirements.

Positive Observations: Secure password hashing (bcrypt), proper JWT signature verification, functional rate limiting and account lockout, secure MFA implementation, no exploitable path traversal or SSTI.

# Methodology

White-box security assessment following OWASP WSTG v4.2 and PTES methodologies. Full source code access with 1,609 files analyzed via automated static analysis (semgrep, gitleaks, trivy, AST-grep). 554 API endpoints across 43 FastAPI backend modules reviewed.

Scope: FastAPI backend, React/React Native frontends, Supabase PostgreSQL database, AI integration (Claude/OpenAI), configuration files. Focus on credential exposure, authentication/authorization, multi-tenant isolation, dependency vulnerabilities.

Testing Phases: (1) Reconnaissance and mapping with static analysis baseline, (2) Specialized agent-driven security analysis covering credentials, JWT security, dependency CVEs, path traversal, SSTI, logger security, (3) Validation through credential testing and JWT forgery proof-of-concept, (4) Reporting with inline code fixes.

Tools: semgrep (SAST), gitleaks (credential scanning), trivy (dependency CVEs), ast-grep (structural analysis), tree-sitter (syntax parsing). Manual code review of authentication and authorization mechanisms.

Limitations: Dynamic testing limited by application runtime setup constraints. No end-to-end testing via running application. SQL injection, XSS, and file upload testing limited to static analysis. Compensated through static root cause identification and credential validation via API tests.

# Technical Analysis

CRITICAL: vuln-0001 Production Supabase credentials in .env.example (CVSS 10.0) - service_role JWT bypasses Row-Level Security, 10-year validity, validated active with production data (25 users, 2 orgs, 46 shifts). Enables unrestricted access to all PHI and financial data.

CRITICAL: vuln-0003 JWT forgery via known SESSION_SECRET (CVSS 10.0) - Publicly accessible secret in .env.example signs all tokens. Attacker forges JWT with arbitrary organization_id and role, bypassing multi-tenant isolation. OrgContextMiddleware trusts claims without server-side validation. Working proof-of-concept developed. Affects all 554 authenticated endpoints.

HIGH: vuln-0005 CVE-2025-71329 in image-size 1.2.1 (CVSS 7.5) - DoS via JXL/HEIF infinite loop. Transitive dependency via metro. Affects mobile build pipeline. No patch available.

HIGH: vuln-0006 CVE-2025-71330 in image-size 1.2.1 (CVSS 7.5) - DoS via ICNS infinite loop. Same impact as CVE-2025-71329.

HIGH: vuln-0007 CVE-2024-23342 in ecdsa 0.19.2 (CVSS 7.4) - Minerva timing attack. Transitive via python-jose. Currently unexploitable (HS256 config), future risk if migrated to ECDSA algorithms.

MEDIUM: vuln-0002 GCP API key exposed (CVSS 6.5) - Valid Firebase key in google-services.json. APIs disabled, limited to quota exhaustion currently.

MEDIUM: vuln-0004 Session bypass (CVSS 6.5) - Optional jti claim allows persistent access after logout.

Systemic Issues: Production secrets in version control, multi-tenant isolation relies solely on JWT claims without server validation, no dependency scanning in CI/CD, missing secrets management infrastructure.

Attack Surface: 554 endpoints, coordinator module largest (94 endpoints), 10 authentication endpoints, file operations, 11+ AI endpoints processing PHI. Highest risk: credential exposure, JWT security, multi-tenant isolation.

# Recommendations

IMMEDIATE (24 hours):
Rotate Supabase credentials via Dashboard. Rotate SESSION_SECRET using cryptographically random value. Force global re-authentication. Audit database access logs. Evaluate Privacy Act 1988 breach notification with legal counsel.

SHORT-TERM (1 week):
Deploy secrets management (Vault/AWS Secrets Manager). Enforce JTI requirement in all tokens. Purge credentials from git history. Add known-secret blocklist to config validator. Implement server-side organization membership validation in middleware.

MEDIUM-TERM (1 month):
Integrate dependency scanning (trivy/Snyk) in CI/CD with patch SLA. Install gitleaks/trufflehog pre-commit hooks. Implement JWT anomaly monitoring. Consider RS256 asymmetric signing migration.

LONG-TERM (3 months):
Security training on credential management. Quarterly SESSION_SECRET rotation. Dependency update policy with testing requirements. Enhanced password requirements. Token binding with device fingerprinting. Rotate GCP API key with restrictions. Schedule retest after remediation.

