# Supabase Storage RLS Fix

The app is successfully reaching Supabase Storage with an authenticated bearer token.

The current upload failure:

```text
403 Unauthorized
new row violates row-level security policy
```

means the bucket policy for `storage.objects` is blocking authenticated inserts to the
`project-files` bucket.

## Recommended fix

Run the following SQL in the Supabase SQL Editor for this project:

```sql
create policy "Authenticated users can view project files bucket objects"
on storage.objects
for select
to authenticated
using (bucket_id = 'project-files');

create policy "Authenticated users can upload project files bucket objects"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'project-files');

create policy "Authenticated users can update project files bucket objects"
on storage.objects
for update
to authenticated
using (bucket_id = 'project-files')
with check (bucket_id = 'project-files');

create policy "Authenticated users can delete project files bucket objects"
on storage.objects
for delete
to authenticated
using (bucket_id = 'project-files');
```

## Why this fixes it

The app stores all user-managed uploads in the same bucket:

- project files
- project photos
- inspection attachments
- task attachments
- selection attachments/photos

The object path varies, but the bucket id is the same: `project-files`.

The current failure is not a bad path issue anymore; it is the missing `insert` policy
on `storage.objects` for authenticated users in this bucket.

## Security note

This is the fastest unblock, but it grants all authenticated users bucket-wide access.
If you want stricter controls later, add path- or owner-based restrictions after uploads
are working again.
