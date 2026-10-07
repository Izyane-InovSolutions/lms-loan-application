import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FlaskConical,
  FolderPlus,
  Loader2,
  Plus,
  RotateCcw,
  Rocket,
  Save,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  FACTS,
  OPERATORS,
  OUTCOMES,
  PRODUCTS,
  PRODUCT_KEYS,
  describeCondition,
  factsForProduct,
  validatePolicies,
} from "@/config/creditRules";
import { api } from "../api";
import { hasPermission } from "@/config/roles";
import { useAuth } from "../auth";
import {
  ErrorState,
  FormError,
  PageHeader,
  Panel,
  SkeletonRows,
  dateTime,
  useToast,
} from "../components";
import { diffPolicies, policiesToCsv } from "../rulesDiff";

const DIFF_TONE = {
  added: "text-success",
  changed: "text-warning",
  removed: "text-destructive",
};
const CONFIRM_TEXT = {
  rule: {
    title: "Delete this rule?",
    body: "It is removed from the draft. To pause it without losing it, switch it off instead.",
    action: "Delete rule",
  },
  policy: {
    title: "Delete this policy?",
    body: "The policy and all its rules are removed from the draft. To pause it without losing it, switch it off instead.",
    action: "Delete policy",
  },
  discard: {
    title: "Discard your changes?",
    body: "Unsaved edits and the saved draft are thrown away. The published version stays as it is.",
    action: "Discard",
  },
  restore: {
    title: "Replace your edits?",
    body: "Restoring puts that version into the draft and drops your unsaved edits.",
    action: "Restore as draft",
  },
};

const OUTCOME_TONE = {
  decline: "text-destructive",
  refer: "text-warning",
  warn: "text-muted-foreground",
};

let tempId = 0;
const nextId = (prefix) => `${prefix}${Date.now()}${(tempId += 1)}`;

/** A blank rule using the first fact valid for the policy's product. */
const blankRule = (product) => {
  const factKey = Object.keys(factsForProduct(product))[0] || "amount";
  return {
    id: nextId("r"),
    fact: factKey,
    operator: "gt",
    value: FACTS[factKey]?.unit === "boolean" ? false : 0,
    outcome: "refer",
    message: "",
    enabled: true,
  };
};

/** A deep copy with fresh ids, so a duplicate never collides with its original. */
const cloneRule = (rule) => ({ ...rule, id: nextId("r") });
const clonePolicy = (policy, existing) => {
  const names = new Set(existing.map((item) => item.name));
  let name = `${policy.name} (copy)`.slice(0, 100);
  for (let n = 2; names.has(name); n += 1)
    name = `${policy.name} (copy ${n})`.slice(0, 100);
  return {
    ...policy,
    id: nextId("p"),
    name,
    rules: policy.rules.map(cloneRule),
  };
};

const download = (filename, type, content) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const ruleMatches = (rule, { query, outcome }) => {
  if (outcome !== "all" && rule.outcome !== outcome) return false;
  if (!query) return true;
  const text =
    `${describeCondition(rule)} ${rule.message || ""} ${FACTS[rule.fact]?.label || ""}`.toLowerCase();
  return text.includes(query.toLowerCase());
};

const blankPolicy = () => ({
  id: nextId("p"),
  name: "New policy",
  product: "personal",
  enabled: true,
  rules: [],
});

export function RulesPage() {
  const { user } = useAuth();
  const notify = useToast();
  const canEdit = hasPermission(user, "rules.manage");
  const [state, setState] = useState({ status: "loading" });
  const [policies, setPolicies] = useState([]);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [simulation, setSimulation] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = async () => {
    try {
      const data = await api("/rules");
      setState({ status: "ready", ...data });
      setPolicies((data.draft || data.published).policies);
      setNote(data.draft?.note || "");
      setDirty(false);
      setSimulation(null);
    } catch (loadError) {
      setState({ status: "error", message: loadError.message });
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Warn before the tab closes with unsaved edits.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const validation = useMemo(() => {
    try {
      validatePolicies(policies);
      return null;
    } catch (validationError) {
      return validationError.message;
    }
  }, [policies]);

  const mutate = (updater) => {
    setPolicies(updater);
    setDirty(true);
    setSimulation(null);
  };
  const updatePolicy = (pi, changes) =>
    mutate((current) =>
      current.map((policy, index) =>
        index === pi ? { ...policy, ...changes } : policy,
      ),
    );
  const updateRule = (pi, ri, changes) =>
    mutate((current) =>
      current.map((policy, index) =>
        index === pi
          ? {
              ...policy,
              rules: policy.rules.map((rule, r) =>
                r === ri ? { ...rule, ...changes } : rule,
              ),
            }
          : policy,
      ),
    );
  const addRule = (pi) =>
    mutate((current) =>
      current.map((policy, index) =>
        index === pi
          ? { ...policy, rules: [...policy.rules, blankRule(policy.product)] }
          : policy,
      ),
    );
  const removeRule = (pi, ri) =>
    mutate((current) =>
      current.map((policy, index) =>
        index === pi
          ? { ...policy, rules: policy.rules.filter((_, r) => r !== ri) }
          : policy,
      ),
    );
  const duplicateRule = (pi, ri) =>
    mutate((current) =>
      current.map((policy, index) =>
        index === pi
          ? {
              ...policy,
              rules: policy.rules.flatMap((rule, r) =>
                r === ri ? [rule, cloneRule(rule)] : [rule],
              ),
            }
          : policy,
      ),
    );
  const duplicatePolicy = (pi) =>
    mutate((current) =>
      current.flatMap((policy, index) =>
        index === pi ? [policy, clonePolicy(policy, current)] : [policy],
      ),
    );
  const toggleCollapsed = (id) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exportRules = (format) => {
    if (format === "json")
      download(
        "policy-rules.json",
        "application/json",
        JSON.stringify(policies, null, 2),
      );
    else download("policy-rules.csv", "text/csv", policiesToCsv(policies));
  };
  const addPolicy = () => mutate((current) => [...current, blankPolicy()]);
  const removePolicy = (pi) =>
    mutate((current) => current.filter((_, index) => index !== pi));

  // Changing a policy's product resets any rule whose fact no longer applies to it.
  const changeProduct = (pi, product) =>
    mutate((current) =>
      current.map((policy, index) => {
        if (index !== pi) return policy;
        const allowed = factsForProduct(product);
        const rules = policy.rules.map((rule) =>
          allowed[rule.fact]
            ? rule
            : {
                ...blankRule(product),
                id: rule.id,
                message: rule.message,
                outcome: rule.outcome,
              },
        );
        return { ...policy, product, rules };
      }),
    );

  const run = async (key, fn) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (runError) {
      setError(runError.message);
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () =>
    run("save", async () => {
      await api("/rules/draft", { method: "PUT", body: { policies, note } });
      notify("Draft saved");
      await load();
    });
  const simulate = () =>
    run("simulate", async () => {
      setSimulation(
        await api("/rules/simulate", { method: "POST", body: { policies } }),
      );
    });
  const discard = () =>
    run("discard", async () => {
      await api("/rules/draft", { method: "DELETE" });
      notify("Draft discarded");
      await load();
    });
  const restore = (version) =>
    run("restore", async () => {
      await api("/rules/restore", { method: "POST", body: { version } });
      notify(`Version ${version} restored as a draft`);
      await load();
    });
  const openVersion = (version) =>
    run("view", async () => {
      const { versions } = await api("/rules/versions");
      const found = versions.find((item) => item.version === version);
      if (found) setViewing(found);
    });
  const publish = () =>
    run("publish", async () => {
      if (dirty)
        await api("/rules/draft", { method: "PUT", body: { policies, note } });
      const { published } = await api("/rules/publish", {
        method: "POST",
        body: { note },
      });
      setPublishOpen(false);
      notify(`Version ${published.version} is now in force`);
      await load();
    });

  if (state.status === "loading") {
    return <SkeletonRows rows={6} />;
  }
  if (state.status === "error") {
    return (
      <ErrorState
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          load();
        }}
      />
    );
  }

  const editing = Boolean(state.draft) || dirty;
  const filtering = Boolean(query.trim()) || outcome !== "all";
  const filter = { query: query.trim(), outcome };
  const changes = diffPolicies(state.published.policies, policies);
  const askDiscard = () =>
    dirty ? setConfirm({ kind: "discard" }) : discard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Policy rules"
        description="The lender’s policy, grouped into policies and checked automatically on every application. Rules recommend; an officer decides unless automatic decline is on in Settings. Turn a policy or rule off with its switch to pause it without losing it, or use the delete icon to remove it for good."
        actions={
          canEdit ? (
            <>
              {editing ? (
                <Button
                  variant="ghost"
                  onClick={askDiscard}
                  disabled={Boolean(busy)}
                >
                  <Undo2 />
                  Discard draft
                </Button>
              ) : null}
              <Button
                variant="outline"
                onClick={() => exportRules("json")}
                disabled={Boolean(busy)}
              >
                <Download />
                JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => exportRules("csv")}
                disabled={Boolean(busy)}
              >
                <Download />
                CSV
              </Button>
              <Button
                variant="outline"
                onClick={simulate}
                disabled={Boolean(busy) || Boolean(validation)}
              >
                {busy === "simulate" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FlaskConical />
                )}
                Try on recent applications
              </Button>
              <Button
                variant="outline"
                onClick={saveDraft}
                disabled={Boolean(busy) || !dirty || Boolean(validation)}
              >
                {busy === "save" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Save />
                )}
                Save draft
              </Button>
              <Button
                onClick={() => setPublishOpen(true)}
                disabled={Boolean(busy) || !editing || Boolean(validation)}
              >
                <Rocket />
                Publish
              </Button>
            </>
          ) : null
        }
      />

      <p className="text-sm text-muted-foreground">
        {state.draft || dirty ? (
          <span className="font-medium text-warning">
            Editing a draft. Version {state.published.version} stays in force
            until you publish.
          </span>
        ) : (
          <>
            In force: version {state.published.version}, published{" "}
            {dateTime(state.published.publishedAt)}.
          </>
        )}
        {state.published.note && !editing ? ` ${state.published.note}` : ""}
      </p>

      {error || (canEdit && validation && dirty) ? (
        <FormError message={error || validation} />
      ) : null}

      {simulation ? <SimulationResult simulation={simulation} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search rules"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rules"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select
          aria-label="Filter by outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          className="h-9 w-44 text-sm"
        >
          <option value="all">All outcomes</option>
          {Object.entries(OUTCOMES).map(([key, entry]) => (
            <option key={key} value={key}>
              {entry.label}
            </option>
          ))}
        </Select>
        {filtering ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setOutcome("all");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="space-y-4">
        {filtering &&
        !policies.some((policy) =>
          policy.rules.some((rule) => ruleMatches(rule, filter)),
        ) ? (
          <p className="text-sm text-muted-foreground">No rules match.</p>
        ) : null}
        {policies.map((policy, pi) =>
          filtering &&
          !policy.rules.some((rule) =>
            ruleMatches(rule, filter),
          ) ? null : canEdit ? (
            <PolicyEditor
              key={policy.id}
              policy={policy}
              filter={filtering ? filter : null}
              collapsed={!filtering && collapsed.has(policy.id)}
              onToggleCollapsed={() => toggleCollapsed(policy.id)}
              onDuplicate={() => duplicatePolicy(pi)}
              onDuplicateRule={(ri) => duplicateRule(pi, ri)}
              onChangeName={(name) => updatePolicy(pi, { name })}
              onChangeProduct={(product) => changeProduct(pi, product)}
              onToggle={(enabled) => updatePolicy(pi, { enabled })}
              onRemove={() => setConfirm({ kind: "policy", pi })}
              onRuleChange={(ri, changes) => updateRule(pi, ri, changes)}
              onRuleRemove={(ri) => setConfirm({ kind: "rule", pi, ri })}
              onAddRule={() => addRule(pi)}
            />
          ) : (
            <PolicyReadOnly
              key={policy.id}
              policy={
                filtering
                  ? {
                      ...policy,
                      rules: policy.rules.filter((rule) =>
                        ruleMatches(rule, filter),
                      ),
                    }
                  : policy
              }
            />
          ),
        )}
        {canEdit ? (
          <Button variant="outline" onClick={addPolicy}>
            <FolderPlus />
            Add a policy
          </Button>
        ) : null}
      </div>

      {state.history.length > 1 ? (
        <Panel title="Earlier versions">
          <ul className="space-y-2 text-sm">
            {state.history.map((version) => (
              <li
                key={version.version}
                className="flex flex-wrap items-baseline gap-x-3"
              >
                <span className="font-medium text-foreground">
                  Version {version.version}
                </span>
                <span className="text-muted-foreground">
                  {version.status === "published" ? "in force" : "retired"},{" "}
                  {version.policyCount} policies, {version.ruleCount} rules,
                  published {dateTime(version.publishedAt)}
                </span>
                {version.note ? (
                  <span className="text-muted-foreground">{version.note}</span>
                ) : null}
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openVersion(version.version)}
                    disabled={Boolean(busy)}
                  >
                    <Eye />
                    View
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        dirty
                          ? setConfirm({
                              kind: "restore",
                              version: version.version,
                            })
                          : restore(version.version)
                      }
                      disabled={Boolean(busy)}
                    >
                      <RotateCcw />
                      Restore as draft
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Each prescreen records the version it used. Changes are also in the{" "}
            <Link to="/admin/audit" className="text-primary hover:underline">
              audit log
            </Link>
            .
          </p>
        </Panel>
      ) : null}

      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Version {viewing?.version}</DialogTitle>
            <DialogDescription>
              {viewing?.status === "published" ? "In force" : "Retired"},
              published {viewing ? dateTime(viewing.publishedAt) : ""}.{" "}
              {viewing?.note || ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {viewing?.policies.map((policy) => (
              <PolicyReadOnly key={policy.id} policy={policy} />
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewing(null)}>
              Close
            </Button>
            {canEdit ? (
              <Button
                onClick={() => {
                  const version = viewing.version;
                  setViewing(null);
                  if (dirty) setConfirm({ kind: "restore", version });
                  else restore(version);
                }}
              >
                <RotateCcw />
                Restore as draft
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{CONFIRM_TEXT[confirm?.kind]?.title}</DialogTitle>
            <DialogDescription>
              {CONFIRM_TEXT[confirm?.kind]?.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                if (action.kind === "rule") removeRule(action.pi, action.ri);
                else if (action.kind === "policy") removePolicy(action.pi);
                else if (action.kind === "discard") discard();
                else if (action.kind === "restore") restore(action.version);
              }}
            >
              {CONFIRM_TEXT[confirm?.kind]?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Publish version {state.published.version + 1}?
            </DialogTitle>
            <DialogDescription>
              New applications are checked against it straight away. Existing
              prescreens keep their version until someone runs them again.
            </DialogDescription>
          </DialogHeader>
          <div
            className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-3 text-sm"
            aria-label="Changes from the version in force"
          >
            {changes.length === 0 ? (
              <p className="text-muted-foreground">
                No differences from version {state.published.version}.
              </p>
            ) : (
              changes.map((change, index) => (
                <div key={index}>
                  <span
                    className={cn(
                      "mr-2 text-xs font-semibold uppercase",
                      DIFF_TONE[change.kind],
                    )}
                  >
                    {change.kind}
                  </span>
                  <span className="text-foreground">{change.title}</span>
                  {change.scope === "rule" ? (
                    <span className="text-muted-foreground">
                      {" "}
                      in {change.policy}
                    </span>
                  ) : null}
                  {change.changes?.map((item) => (
                    <p
                      key={item.field}
                      className="ml-4 text-xs text-muted-foreground"
                    >
                      {item.field}: {item.from} to {item.to}
                    </p>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="space-y-2">
            <label htmlFor="publish-note" className="text-sm font-medium">
              What changed and why
            </label>
            <Input
              id="publish-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Split personal and business into separate policies"
            />
          </div>
          {error ? <FormError message={error} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={publish} disabled={busy === "publish"}>
              {busy === "publish" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Rocket />
              )}
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A labelled on/off switch. Shows a matching status badge next to it. */
function StatusToggle({ enabled, onToggle, label, disabled = false }) {
  return (
    <div className="flex items-center gap-2">
      <StatusBadge enabled={enabled} />
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? `Disable ${label}` : `Enable ${label}`}
        title={enabled ? `Disable ${label}` : `Enable ${label}`}
        onClick={() => onToggle(!enabled)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          enabled ? "bg-[hsl(var(--primary))]" : "bg-muted-foreground/30",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** A pill that reads Enabled or Disabled. */
function StatusBadge({ enabled }) {
  return enabled ? (
    <Badge variant="success">Enabled</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Disabled
    </Badge>
  );
}

/** One editable policy: its name, product and on/off, then its rules. */
function PolicyEditor({
  policy,
  filter,
  collapsed,
  onToggleCollapsed,
  onDuplicate,
  onDuplicateRule,
  onChangeName,
  onChangeProduct,
  onToggle,
  onRemove,
  onRuleChange,
  onRuleRemove,
  onAddRule,
}) {
  const enabledCount = policy.rules.filter((rule) => rule.enabled).length;
  // When the policy is off the whole card is locked: only its own toggle stays live.
  const locked = !policy.enabled;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border-2 bg-card shadow-sm",
        locked && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-primary/20 bg-primary/5 px-4 py-3.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand policy" : "Collapse policy"}
          title={collapsed ? "Expand" : "Collapse"}
          className="h-9 w-9"
        >
          {collapsed ? <ChevronRight /> : <ChevronDown />}
        </Button>
        <Input
          aria-label="Policy name"
          value={policy.name}
          onChange={(event) => onChangeName(event.target.value)}
          disabled={locked}
          className="h-9 max-w-xs flex-1 text-base font-semibold"
        />
        <Select
          aria-label="Applies to"
          value={policy.product}
          onChange={(event) => onChangeProduct(event.target.value)}
          disabled={locked}
          className="h-9 w-32 text-sm"
        >
          {PRODUCT_KEYS.map((key) => (
            <option key={key} value={key}>
              {PRODUCTS[key]}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          {enabledCount} of {policy.rules.length}{" "}
          {policy.rules.length === 1 ? "rule" : "rules"} on
        </span>
        <div className="ml-auto flex items-center gap-2">
          <StatusToggle
            enabled={policy.enabled}
            onToggle={onToggle}
            label="policy"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={onDuplicate}
            aria-label="Duplicate policy"
            title="Duplicate policy"
            className="h-9 w-9 text-muted-foreground"
          >
            <Copy />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Delete policy"
            title="Delete policy"
            className="h-9 w-9 text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {collapsed ? null : (
        <>
          <ul className="divide-y">
            {policy.rules.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No rules in this policy yet.
              </li>
            ) : (
              policy.rules.map((rule, ri) =>
                filter && !ruleMatches(rule, filter) ? null : (
                  <RuleEditor
                    key={rule.id}
                    onDuplicate={() => onDuplicateRule(ri)}
                    rule={rule}
                    product={policy.product}
                    policyEnabled={policy.enabled}
                    onChange={(changes) => onRuleChange(ri, changes)}
                    onRemove={() => onRuleRemove(ri)}
                  />
                ),
              )
            )}
          </ul>
          <div className="border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onAddRule}
              disabled={locked}
            >
              <Plus />
              Add a rule
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** One rule row inside a policy. The product is the policy's, so there is no product chip here. */
function RuleEditor({
  rule,
  product,
  policyEnabled,
  onChange,
  onRemove,
  onDuplicate,
}) {
  const allowed = factsForProduct(product);
  const fact = allowed[rule.fact] || FACTS[rule.fact];
  const operator = OPERATORS[rule.operator];
  // Fields are locked while the rule is off, or while the whole policy is off.
  const locked = !policyEnabled || !rule.enabled;
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_12rem_auto]",
        locked && "bg-muted/50 opacity-60",
      )}
    >
      <div className="min-w-0 space-y-2">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_7rem]">
          <Select
            aria-label="What it checks"
            value={rule.fact}
            onChange={(event) => {
              const next = allowed[event.target.value];
              onChange({
                fact: event.target.value,
                value: next.unit === "boolean" ? false : rule.value,
              });
            }}
            disabled={locked}
            className="h-9 text-sm"
          >
            {Object.entries(allowed).map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Comparison"
            value={rule.operator}
            onChange={(event) => onChange({ operator: event.target.value })}
            disabled={locked}
            className="h-9 text-sm"
          >
            {Object.entries(OPERATORS).map(([key, entry]) => (
              <option key={key} value={key}>
                {entry.label}
              </option>
            ))}
          </Select>
          {operator?.noValue ? (
            <span />
          ) : fact?.unit === "boolean" ? (
            <Select
              aria-label="Value"
              value={String(rule.value)}
              onChange={(event) =>
                onChange({ value: event.target.value === "true" })
              }
              disabled={locked}
              className="h-9 text-sm"
            >
              <option value="true">yes</option>
              <option value="false">no</option>
            </Select>
          ) : (
            <Input
              aria-label="Value"
              type="number"
              step="any"
              value={rule.value ?? ""}
              onChange={(event) => onChange({ value: event.target.value })}
              disabled={locked}
              className="h-9 text-sm"
            />
          )}
        </div>
        <Input
          aria-label="Message for the officer"
          value={rule.message}
          onChange={(event) => onChange({ message: event.target.value })}
          placeholder="What the concern is, in words the officer will read"
          disabled={locked}
          className="h-9 text-sm"
        />
      </div>
      <div className="col-start-1 self-start lg:col-start-auto">
        <Select
          aria-label="Then"
          value={rule.outcome}
          onChange={(event) => onChange({ outcome: event.target.value })}
          disabled={locked}
          className={cn("h-9 text-sm font-medium", OUTCOME_TONE[rule.outcome])}
        >
          {Object.entries(OUTCOMES).map(([key, entry]) => (
            <option key={key} value={key}>
              Then: {entry.label.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <div className="row-start-1 flex items-center gap-1 self-start lg:row-start-auto">
        <StatusToggle
          enabled={rule.enabled}
          onToggle={(enabled) => onChange({ enabled })}
          label="rule"
          disabled={!policyEnabled}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onDuplicate}
          disabled={!policyEnabled}
          aria-label="Duplicate rule"
          title="Duplicate rule"
          className="h-9 w-9 text-muted-foreground disabled:opacity-40"
        >
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={locked}
          aria-label="Delete rule"
          title="Delete rule"
          className="h-9 w-9 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

/** Read-only policy view for officers and sales managers. */
function PolicyReadOnly({ policy }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm",
        !policy.enabled && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Policy
        </span>
        <span className="text-sm font-semibold text-foreground">
          {policy.name}
        </span>
        <Badge variant="outline">{PRODUCTS[policy.product]}</Badge>
        <div className="ml-auto">
          <StatusBadge enabled={policy.enabled} />
        </div>
      </div>
      <ul className="divide-y">
        {policy.rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "grid gap-2 px-4 py-3 text-sm lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2fr)_auto]",
              !rule.enabled && "opacity-50",
            )}
          >
            <span className="text-foreground">{describeCondition(rule)}</span>
            <span className={cn("font-medium", OUTCOME_TONE[rule.outcome])}>
              {OUTCOMES[rule.outcome].label}
            </span>
            <span className="text-muted-foreground">{rule.message}</span>
            <div className="lg:justify-self-end">
              <StatusBadge enabled={rule.enabled} />
            </div>
          </li>
        ))}
        {policy.rules.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">No rules.</li>
        ) : null}
      </ul>
    </div>
  );
}

const OUTCOME_KEYS = ["pass", "refer", "decline"];
const OUTCOME_NAMES = { pass: "Pass", refer: "Refer", decline: "Decline" };

/** Before/after split of recent applications, and the ones that would change. */
function SimulationResult({ simulation }) {
  if (!simulation.sample) {
    return (
      <Panel title="Trial run">
        No prescreened applications yet to try the rules on.
      </Panel>
    );
  }
  return (
    <Panel
      title="Trial run"
      description={`The last ${simulation.sample} prescreened applications, replayed with these policies.`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {OUTCOME_KEYS.map((key) => {
          const before = simulation.current[key];
          const after = simulation.proposed[key];
          const delta = after - before;
          return (
            <div key={key} className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">
                {OUTCOME_NAMES[key]}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
                {after}
                <span
                  className={cn(
                    "ml-2 text-sm font-medium",
                    delta === 0
                      ? "text-muted-foreground"
                      : delta > 0
                        ? key === "pass"
                          ? "text-success"
                          : "text-warning"
                        : key === "pass"
                          ? "text-warning"
                          : "text-success",
                  )}
                >
                  {delta === 0
                    ? "no change"
                    : `${delta > 0 ? "+" : ""}${delta}`}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">was {before}</p>
            </div>
          );
        })}
      </div>
      {simulation.changedCount ? (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground">
            {simulation.changedCount}{" "}
            {simulation.changedCount === 1
              ? "application would change"
              : "applications would change"}
          </p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-sm">
            {simulation.changed.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-2">
                <Link
                  to={`/admin/applications/${row.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {row.reference}
                </Link>
                <span className="text-muted-foreground">
                  {row.applicantName}: {OUTCOME_NAMES[row.from]} to{" "}
                  {OUTCOME_NAMES[row.to]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No outcome would change.
        </p>
      )}
    </Panel>
  );
}
