from app.services.supabase_client import get_supabase_admin
sb = get_supabase_admin()

orgs = sb.table("organizations").select("id, name").execute()
print("Organizations:")
for o in orgs.data:
    print(" -", o.get("id"), o.get("name"))

print()
users = sb.table("users").select("email, organization_id, role").in_(
    "email", ["director@sunshine-demo.com", "lisa@harborview-demo.com"]
).execute()
print("Test users:")
for u in users.data:
    print(" -", u.get("email"), "| org:", u.get("organization_id"), "| role:", u.get("role"))
