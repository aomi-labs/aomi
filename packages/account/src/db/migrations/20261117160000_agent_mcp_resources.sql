-- Run once against the account database before the agent-route cutover.
begin;

create temporary table agent_mcp_resources on commit drop as
select r.identifier as old_uri,
       regexp_replace(r.identifier, '/v1/apps/[^/]+/mcp$',
         '/v1/agents/' || a.publisher || '%2F' || a.name || '/mcp') as new_uri
from ba_oauth_resources r
join agents a on a.name = substring(r.identifier from '/v1/apps/([^/]+)/mcp$')
where r.identifier ~ '/v1/apps/[^/]+/mcp$';

do $$
begin
  if exists (
    select r.identifier from ba_oauth_resources r
    left join agent_mcp_resources m on m.old_uri = r.identifier
    where r.identifier ~ '/v1/apps/[^/]+/mcp$'
    group by r.identifier having count(m.new_uri) <> 1
  ) then
    raise exception 'Hosted MCP resource has no unique agent slug';
  end if;
end $$;

-- Insert before moving foreign keys; existing canonical resources retain their policy.
insert into ba_oauth_resources
  (id, identifier, name, access_token_ttl, refresh_token_ttl,
   signing_algorithm, signing_key_id, allowed_scopes, custom_claims,
   dpop_bound_access_tokens_required, disabled, created_at, updated_at,
   policy_version, metadata)
select r.id || ':agents', m.new_uri, r.name, r.access_token_ttl, r.refresh_token_ttl,
       r.signing_algorithm, r.signing_key_id, r.allowed_scopes, r.custom_claims,
       r.dpop_bound_access_tokens_required, r.disabled, r.created_at, r.updated_at,
       r.policy_version, r.metadata
from ba_oauth_resources r join agent_mcp_resources m on m.old_uri = r.identifier
on conflict (identifier) do nothing;

delete from ba_oauth_client_resources old
using agent_mcp_resources m, ba_oauth_client_resources canonical
where old.resource_id = m.old_uri and canonical.resource_id = m.new_uri
  and old.client_id = canonical.client_id;

update ba_oauth_client_resources links set resource_id = m.new_uri
from agent_mcp_resources m where links.resource_id = m.old_uri;

-- Better Auth stores resource arrays as jsonb, including pending device grants.
do $$
declare relation text;
begin
  foreach relation in array array['ba_oauth_consents', 'ba_oauth_access_tokens',
                                  'ba_oauth_refresh_tokens', 'ba_oauth_device_codes'] loop
    execute format('update %I grant_row set resources = (
      select jsonb_agg(coalesce(to_jsonb(m.new_uri), entry.value) order by entry.position)
      from jsonb_array_elements(grant_row.resources) with ordinality entry(value, position)
      left join agent_mcp_resources m on entry.value = to_jsonb(m.old_uri)
    ) where exists (
      select 1 from jsonb_array_elements(grant_row.resources) entry
      join agent_mcp_resources m on entry = to_jsonb(m.old_uri)
    )', relation);
  end loop;
end $$;

delete from ba_oauth_resources r using agent_mcp_resources m where r.identifier = m.old_uri;
commit;
