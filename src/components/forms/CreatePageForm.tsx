import {
  ActionPanel,
  Clipboard,
  Icon,
  Form,
  showToast,
  useNavigation,
  Action,
  Toast,
  closeMainWindow,
  PopToRootType,
  Keyboard,
} from "@raycast/api";
import { useForm, FormValidation } from "@raycast/utils";
import { useState } from "react";

import {
  useDatabaseProperties,
  useDatabases,
  useVisibleDatabasePropIds,
  useRecentPages,
  useRelations,
  useUsers,
} from "../../hooks";
import { createDatabasePage, DatabaseProperty } from "../../utils/notion";
import { handleOnOpenPage } from "../../utils/openPage";
import { ActionSetVisibleProperties } from "../actions";
import { ActionSetOrderProperties } from "../actions";

import { createConvertToFieldFunc, FieldProps } from "./PagePropertyField";

export type CreatePageFormValues = {
  database: string | undefined;
  [K: string]: Form.Value | undefined;
  closeAfterSave?: boolean;
  content: string;
};

type LaunchContext = {
  visiblePropIds?: string[];
  defaults?: CreatePageFormValues;
};

type CreatePageFormProps = {
  mutate?: () => Promise<void>;
  launchContext?: LaunchContext;
  defaults?: Partial<CreatePageFormValues>;
};

type Quicklink = Action.CreateQuicklink.Props["quicklink"];

const createPropertyId = (property: DatabaseProperty) => "property::" + property.type + "::" + property.id;

const NON_EDITABLE_PROPERTY_TYPES = ["formula"];
const filterNoEditableProperties = (dp: DatabaseProperty) => !NON_EDITABLE_PROPERTY_TYPES.includes(dp.type);

export function CreatePageForm({ mutate, launchContext, defaults }: CreatePageFormProps) {
  const closeAfterCreate = true;
  const defaultValues = launchContext?.defaults ?? defaults;
  const initialDatabaseId = defaultValues?.database;

  const [databaseId, setDatabaseId] = useState<string | null>(initialDatabaseId ? initialDatabaseId : null);
  const { data: databaseProperties } = useDatabaseProperties(databaseId, filterNoEditableProperties);
  const { visiblePropIds, setVisiblePropIds } = useVisibleDatabasePropIds(
    databaseId || "__no_id__",
    launchContext?.visiblePropIds,
  );
  const { data: users } = useUsers();
  const { data: databases, isLoading: isLoadingDatabases } = useDatabases();
  const { data: relationPages, isLoading: isLoadingRelationPages } = useRelations(databaseProperties);
  const { setRecentPage } = useRecentPages();

  const databasePropertyIds = databaseProperties.map((dp) => dp.id) || [];

  const initialValues: Partial<CreatePageFormValues> = { database: databaseId ?? undefined };
  const validation: Parameters<typeof useForm<CreatePageFormValues>>[0]["validation"] = {};
  for (const { id, type } of databaseProperties) {
    if (NON_EDITABLE_PROPERTY_TYPES.includes(type)) continue;
    const key = "property::" + type + "::" + id;
    if (type == "title") validation[key] = FormValidation.Required;
    let value = defaultValues?.[key];
    if (type == "date" && value) value = new Date(value as string);
    initialValues[key] = value;
  }

  const { itemProps, values, handleSubmit, reset, focus } = useForm<CreatePageFormValues>({
    initialValues,
    validation,
    async onSubmit(values) {
      const { closeAfterSave, ...pageValues } = values;
      try {
        if (closeAfterSave) {
          await closeMainWindow({ popToRootType: PopToRootType.Suspended });
        }

        await showToast({ style: Toast.Style.Animated, title: "Creating page" });

        const page = await createDatabasePage({
          ...initialValues,
          ...pageValues,
        });

        await showToast({
          style: Toast.Style.Success,
          title: "Page created",
          primaryAction: {
            title: "Open Page",
            shortcut: { modifiers: ["cmd"], key: "o" },
            onAction: () => handleOnOpenPage(page, setRecentPage),
          },
          secondaryAction: page.url
            ? {
                title: "Copy URL",
                shortcut: { modifiers: ["cmd", "shift"], key: "c" },
                onAction: () => {
                  Clipboard.copy(page.url as string);
                },
              }
            : undefined,
        });

        if (mutate) {
          await mutate();
          useNavigation().pop();
        } else {
          reset(initialValues);
          const titleProperty = databaseProperties?.find((dp) => dp.type == "title");
          titleProperty && focus(createPropertyId(titleProperty));
        }
      } catch (error) {
        console.error(error);
        await showToast({ style: Toast.Style.Failure, title: "Failed to create page" });
      }
    },
  });

  function filterProperties(dp: DatabaseProperty) {
    return !visiblePropIds || visiblePropIds.includes(dp.id);
  }

  function sortProperties(a: DatabaseProperty, b: DatabaseProperty) {
    if (!visiblePropIds) {
      if (a.type == "title") return -1;
      if (b.type == "title") return 1;
      return 0;
    }

    const valueA = visiblePropIds.indexOf(a.id);
    const valueB = visiblePropIds.indexOf(b.id);
    if (valueA > valueB) return 1;
    if (valueA < valueB) return -1;
    return 0;
  }

  function getQuicklink(): Quicklink {
    const url = "raycast://extensions/HenriChabrand/notion/take-quick-notes";
    const launchContext: LaunchContext = { defaults: values, visiblePropIds: visiblePropIds ?? databasePropertyIds };
    let name: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const databaseTitle = databases.find((d: any) => d.id == databaseId)?.title;
    if (databaseTitle) name = "Create new page in " + databaseTitle;
    return { name, link: url + "?launchContext=" + encodeURIComponent(JSON.stringify(launchContext)) };
  }

  if (!isLoadingDatabases && !databases.length) {
    showToast({
      style: Toast.Style.Failure,
      title: "No databases found",
      message: "Please make sure you have access to at least one database",
    });
  }

  function itemPropsFor<T extends DatabaseProperty["type"]>(property: DatabaseProperty) {
    const id = createPropertyId(property);
    return {
      ...(itemProps[id] as FieldProps<T>),
      title: property.name,
      key: id,
      id,
    };
  }

  const convertToField = createConvertToFieldFunc(itemPropsFor, relationPages, users);

  const renderSubmitAction = (type: "main" | "second") => {
    const shortcut: Keyboard.Shortcut | undefined =
      type === "second" ? { modifiers: ["cmd", "shift"], key: "enter" } : undefined;

    if ((!closeAfterCreate && type === "main") || (closeAfterCreate && type === "second")) {
      return <Action.SubmitForm title="Create Page" icon={Icon.Plus} onSubmit={handleSubmit} shortcut={shortcut} />;
    } else {
      return (
        <Action.SubmitForm
          title="Create Page and Close"
          icon={Icon.Plus}
          onSubmit={async (values: CreatePageFormValues) => {
            handleSubmit({ ...values, closeAfterSave: true });
          }}
          shortcut={shortcut}
        />
      );
    }
  };

  return (
    <Form
      isLoading={isLoadingDatabases || isLoadingRelationPages}
      navigationTitle={initialDatabaseId ? "Create New Page" : "Create Database Page"}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {renderSubmitAction("main")}
            {renderSubmitAction("second")}
            <Action.CreateQuicklink
              title="Create Quicklink to Command as Configured"
              quicklink={getQuicklink()}
              icon={Icon.Link}
            />
          </ActionPanel.Section>
          {databaseProperties ? (
            <ActionPanel.Section title="View options">
              <ActionSetVisibleProperties
                databaseProperties={databaseProperties.filter((dp) => dp.id !== "title")}
                selectedPropertiesIds={visiblePropIds || databasePropertyIds}
                onSelect={(propertyId) =>
                  setVisiblePropIds(visiblePropIds ? [...visiblePropIds, propertyId] : [propertyId])
                }
                onUnselect={(propertyId) =>
                  setVisiblePropIds((visiblePropIds || databasePropertyIds).filter((pid) => pid !== propertyId))
                }
              />
              <ActionSetOrderProperties
                databaseProperties={databaseProperties}
                propertiesOrder={visiblePropIds || databasePropertyIds}
                onChangeOrder={setVisiblePropIds}
              />
            </ActionPanel.Section>
          ) : null}
        </ActionPanel>
      }
    >
      {databaseProperties?.filter(filterProperties).sort(sortProperties).map(convertToField)}
      <Form.Separator />
      <Form.TextArea
        {...itemProps["content"]}
        id="content"
        title="Page Content"
        enableMarkdown
      />
      {initialDatabaseId ? null : (
        <>
          <Form.Separator key="separator" />
          <Form.Dropdown
            title="Database"
            {...itemProps.database}
            onChange={(value) => {
              setDatabaseId(value);
              itemProps.database.onChange?.(value);
            }}
          >
            {databases?.map(
              (
                d: any, // eslint-disable-line @typescript-eslint/no-explicit-any
              ) => {
                return (
                  <Form.Dropdown.Item
                    key={d.id}
                    value={d.id}
                    title={d.title ? d.title : "Untitled"}
                    icon={
                      d.icon_emoji
                        ? d.icon_emoji
                        : d.icon_file
                          ? d.icon_file
                          : d.icon_external
                            ? d.icon_external
                            : Icon.List
                    }
                  />
                );
              },
            )}
          </Form.Dropdown>
        </>
      )}
    </Form>
  );
}
