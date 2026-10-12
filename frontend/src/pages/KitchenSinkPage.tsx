import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Plus, Settings, Trash2 } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { ApiError } from '@/lib/api';
import {
  Alert,
  AlertDialog,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  ChipInput,
  CodeBlock,
  DataTable,
  Dialog,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  Field,
  FormErrorSummary,
  IconButton,
  Input,
  KeyValueList,
  Kbd,
  MethodBadge,
  MultiSelect,
  notifyError,
  notifySuccess,
  PageHeader,
  PasswordInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  Select,
  Skeleton,
  StatusBadge,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  type Column,
} from '@/components/ui';

type Row = { id: number; name: string; owner: string; calls: number };
const ROWS: Row[] = Array.from({ length: 32 }, (_, i) => ({
  id: i + 1,
  name: `Service ${String(i + 1).padStart(2, '0')}`,
  owner: ['payments', 'identity', 'search'][i % 3],
  calls: (i * 7919) % 1000,
}));

/** Every component in both themes (development builds only, /__ui). Not translated on purpose. */
export default function KitchenSinkPage() {
  const { i18n } = useTranslation();
  const { setPreference, resolved } = useTheme();
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(false);
  const [radio, setRadio] = useState('a');
  const [select, setSelect] = useState('get');
  const [multi, setMulti] = useState<number[]>([1]);
  const [chips, setChips] = useState<string[]>(['payments']);
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [alert, setAlert] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const columns: Column<Row>[] = [
    { id: 'name', header: 'Name', sortValue: (r) => r.name, cell: (r) => r.name },
    {
      id: 'owner',
      header: 'Owner',
      sortValue: (r) => r.owner,
      cell: (r) => <Badge variant="outline">{r.owner}</Badge>,
    },
    {
      id: 'calls',
      header: 'Calls',
      sortValue: (r) => r.calls,
      cell: (r) => <span className="tabular-nums">{r.calls}</span>,
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: 'Development', to: '/' }, { label: 'Kitchen sink' }]}
        title="Kitchen sink"
        description={`Theme: ${resolved}, language: ${i18n.language}.`}
        actions={
          <>
            <Button onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>Toggle theme</Button>
            <Button onClick={() => void i18n.changeLanguage(i18n.language === 'tr' ? 'en' : 'tr')}>
              Toggle language
            </Button>
          </>
        }
      />

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="accent">
            <Plus aria-hidden="true" />
            Accent CTA
          </Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 aria-hidden="true" />
            Destructive
          </Button>
          <Button variant="destructive-ghost">Destructive ghost</Button>
          <Button variant="link">Link</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <IconButton label="Settings" icon={<Settings aria-hidden="true" />} />
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="info">Info</Badge>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => (
            <MethodBadge key={m} method={m} />
          ))}
          {[200, 302, 404, 502, 0].map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </div>
      </Section>

      <Section title="Alerts">
        <div className="space-y-2">
          <Alert variant="info" title="Info">
            Spec refreshed 3 minutes ago.
          </Alert>
          <Alert variant="success">Saved.</Alert>
          <Alert variant="warning" title="Warning">
            TLS verification is off.
          </Alert>
          <Alert variant="destructive">The upstream request failed.</Alert>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" required helper="Shown in the catalog.">
            <Input placeholder="Payments API" />
          </Field>
          <Field label="Slug" error="Required.">
            <Input />
          </Field>
          <Field label="Password">
            <PasswordInput autoComplete="off" />
          </Field>
          <Field label="Method">
            <Select
              value={select}
              onValueChange={setSelect}
              options={[
                { value: 'get', label: 'GET' },
                { value: 'post', label: 'POST', description: 'Creates a resource' },
                { value: 'delete', label: 'DELETE', disabled: true },
              ]}
            />
          </Field>
          <Field label="Groups">
            <MultiSelect
              options={[
                { value: 1, label: 'payments-team' },
                { value: 2, label: 'identity' },
                { value: 3, label: 'auditors' },
              ]}
              value={multi}
              onChange={setMulti}
            />
          </Field>
          <Field label="Tags" helper="Type and press Enter.">
            <ChipInput suggestions={['payments', 'internal', 'beta']} value={chips} onChange={setChips} />
          </Field>
          <Field label="Description" optional className="md:col-span-2">
            <Textarea />
          </Field>
          <div className="space-y-3">
            <Checkbox
              label="Active"
              description="Shown in the catalog."
              checked={checked}
              onCheckedChange={setChecked}
            />
            <Switch label="Try it" description="Users may call the API." checked={on} onCheckedChange={setOn} />
          </div>
          <RadioGroup
            label="Access level"
            value={radio}
            onValueChange={setRadio}
            options={[
              { value: 'a', label: 'View', description: 'See the documentation' },
              { value: 'b', label: 'Invoke', description: 'Also call it' },
            ]}
          />
        </div>
        <div className="mt-4">
          <FormErrorSummary errors={[{ field: 'slug', message: 'Slug is required.' }]} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog(true)}>Dialog</Button>
          <Button onClick={() => setDrawer(true)}>Drawer</Button>
          <Button variant="destructive" onClick={() => setAlert(true)}>
            Alert dialog
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button>Popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm">Popover content.</PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem destructive>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip content="Tooltip text">
            <Button>Tooltip</Button>
          </Tooltip>
          <Button onClick={() => notifySuccess('Saved.')}>Toast</Button>
          <Button
            onClick={() =>
              notifyError(new ApiError(502, 'The upstream request failed.', 'upstream_error', 'abc123'), 'x')
            }
          >
            Error toast
          </Button>
        </div>
        <Dialog
          open={dialog}
          onOpenChange={setDialog}
          title="Dialog"
          description="A short form."
          footer={<Button onClick={() => setDialog(false)}>Close</Button>}
        >
          <Field label="Name">
            <Input />
          </Field>
        </Dialog>
        <Drawer open={drawer} onOpenChange={setDrawer} title="Drawer" footer={<Button variant="primary">Save</Button>}>
          <div className="p-4">Record form.</div>
        </Drawer>
        <AlertDialog
          open={alert}
          onOpenChange={setAlert}
          title="Delete Payments API?"
          description="Its permissions and access grants are removed too."
          confirmLabel="Delete"
          confirmText="payments"
          onConfirm={() => undefined}
        />
      </Section>

      <Section title="Tabs, cards, data">
        <Tabs defaultValue="one">
          <TabsList label="Example tabs">
            <TabsTrigger value="one">Overview</TabsTrigger>
            <TabsTrigger value="two">Details</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <Card>
              <CardHeader title="Card" description="Border, no shadow." actions={<Button size="sm">Action</Button>} />
              <CardContent>
                <KeyValueList
                  items={[
                    { label: 'Slug', value: 'payments', mono: true },
                    {
                      label: 'Base URL',
                      value: 'https://payments.internal.example.com/v1/very/long/path/that/wraps',
                      mono: true,
                    },
                  ]}
                />
              </CardContent>
              <CardFooter>
                <Button variant="primary">Save</Button>
              </CardFooter>
            </Card>
          </TabsContent>
          <TabsContent value="two">
            <CodeBlock
              label="application/json"
              code={JSON.stringify({ id: 'ch_1', amount: 10, currency: 'EUR' }, null, 2)}
            />
          </TabsContent>
        </Tabs>
        <div className="mt-4">
          <DataTable
            caption="Example rows"
            rows={ROWS}
            columns={columns}
            rowKey={(r) => String(r.id)}
            rowLabel={(r) => r.name}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            toolbar={<span className="text-[13px] text-muted-foreground">{selected.length} selected</span>}
          />
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <EmptyState
              icon={Boxes}
              title="No APIs yet"
              description="Register the first one."
              action={<Button variant="accent">New API</Button>}
            />
          </Card>
          <Card>
            <ErrorState
              error={new ApiError(500, 'Database is locked.', 'internal_error', 'Kguzvp0W4Jf6ngXw')}
              onRetry={() => undefined}
            />
          </Card>
          <Card className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4" />
            <Skeleton className="h-24" />
          </Card>
        </div>
        <div className="mt-4">
          <Breadcrumbs label="Example breadcrumb" items={[{ label: 'Catalog', to: '/' }, { label: 'Payments API' }]} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`ks-${title}`}>
      <h2 id={`ks-${title}`} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
