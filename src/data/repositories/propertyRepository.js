import { emit } from '../appEventBus.js';
import { canUseLocalPersistenceFallback, isProductionMode, requireRemoteResult } from '../appMode.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const ACCESS_INFO_FIELDS = ['gate_code', 'access_notes', 'parking_notes', 'hazards'];
const PROPERTY_FIELDS = [
  'property_id',
  'company_id',
  'customer_id',
  'service_plan_id',
  'service_address',
  'service_type',
  'recurring_frequency',
  'default_price',
  'notes',
  'gate_code',
  'access_notes',
  'parking_notes',
  'hazards',
  'recurring_schedule',
  'status',
  'created_at',
  'updated_at'
];

const PROPERTY_SELECT_FIELDS = PROPERTY_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makePropertyId() {
  return `prop_${crypto.randomUUID().slice(0, 8)}`;
}

function localProperties() {
  return readState().properties || [];
}

function writeLocalProperties(properties, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    properties
  };

  writeState(nextState, metadata);
  return properties;
}

function emitPropertiesChanged(payload) {
  emit('properties:changed', payload);
}

function normalizePropertyForSupabase(property) {
  return PROPERTY_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(property, field)) {
      record[field] = property[field] ?? null;
    }
    return record;
  }, {
    property_id: property.property_id,
    company_id: property.company_id,
    customer_id: property.customer_id,
    service_address: property.service_address || '',
    service_type: property.service_type || '',
    recurring_frequency: property.recurring_frequency || 'one-time',
    default_price: Number(property.default_price ?? 0),
    status: property.status || 'active'
  });
}

async function readSupabaseProperties(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('properties', {
    select: PROPERTY_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'service_address.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function readSupabaseProperty(propertyId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId) return null;

  const response = await supabaseSelect('properties', {
    select: PROPERTY_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    property_id: `eq.${propertyId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseProperty(property) {
  const record = normalizePropertyForSupabase(property);
  if (!record.property_id || !record.company_id || !record.customer_id) return null;

  const response = await supabaseUpsert('properties', record, {
    onConflict: 'property_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseProperties(properties) {
  const records = properties.map(normalizePropertyForSupabase).filter((property) => (
    property.property_id && property.company_id && property.customer_id
  ));
  if (!records.length) return null;

  const response = await supabaseUpsert('properties', records, {
    onConflict: 'property_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

export async function syncPropertiesFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const properties = await readSupabaseProperties(companyId);
  if (!properties) return null;

  if (!properties.length && canUseLocalPersistenceFallback() && (state.properties || []).length) {
    const bootstrappedProperties = await writeSupabaseProperties(state.properties || []);
    if (!bootstrappedProperties) return null;

    writeLocalProperties(bootstrappedProperties, {
      action: 'properties:bootstrap-supabase'
    });

    return clone(bootstrappedProperties);
  }

  writeLocalProperties(properties, {
    action: 'properties:sync-from-supabase'
  });

  return clone(properties);
}

export function listProperties() {
  return clone(localProperties());
}

export async function listPropertiesAsync() {
  const properties = await readSupabaseProperties(await resolveRepositoryCompanyId());
  return requireRemoteResult(properties, 'Production property read failed.') || listProperties();
}

export function getProperty(propertyId) {
  const property = localProperties().find((item) => item.property_id === propertyId);
  return cloneOrNull(property);
}

export async function getPropertyAsync(propertyId) {
  const property = await readSupabaseProperty(propertyId);
  return requireRemoteResult(property, 'Production property read failed.') || getProperty(propertyId);
}

export async function createProperty(propertyInput = {}) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const property = {
    property_id: propertyInput.property_id || makePropertyId(),
    company_id: propertyInput.company_id || companyId,
    customer_id: propertyInput.customer_id,
    service_plan_id: propertyInput.service_plan_id,
    service_address: propertyInput.service_address,
    service_type: propertyInput.service_type,
    recurring_frequency: propertyInput.recurring_frequency,
    default_price: propertyInput.default_price,
    status: propertyInput.status || 'active',
    notes: propertyInput.notes || '',
    gate_code: propertyInput.gate_code,
    access_notes: propertyInput.access_notes,
    parking_notes: propertyInput.parking_notes,
    hazards: propertyInput.hazards,
    recurring_schedule: propertyInput.recurring_schedule,
    created_at: propertyInput.created_at || new Date().toISOString()
  };

  const persistedProperty = requireRemoteResult(
    await writeSupabaseProperty(property),
    'Production property create failed.'
  ) || property;
  writeLocalProperties([...(state.properties || []), persistedProperty], {
    action: 'property:create',
    property_id: persistedProperty.property_id
  });

  emitPropertiesChanged({
    action: 'create',
    property_id: persistedProperty.property_id,
    property: clone(persistedProperty)
  });

  return clone(persistedProperty);
}

export async function updateProperty(propertyId, patch = {}, metadata = {}) {
  const state = readState();
  const sourceProperties = isProductionMode()
    ? await readSupabaseProperties(await resolveRepositoryCompanyId())
    : (state.properties || []);
  let updatedProperty = null;

  const properties = requireRemoteResult(sourceProperties, 'Production property read failed.') || [];
  const nextProperties = properties.map((property) => {
    if (property.property_id !== propertyId) return property;
    updatedProperty = {
      ...property,
      ...patch
    };
    return updatedProperty;
  });

  if (!updatedProperty) return null;
  const persistedProperty = requireRemoteResult(
    await writeSupabaseProperty(updatedProperty),
    'Production property update failed.'
  ) || updatedProperty;
  const persistedProperties = nextProperties.map((property) => (
    property.property_id === propertyId ? persistedProperty : property
  ));

  writeLocalProperties(persistedProperties, {
    ...metadata,
    action: metadata.action || 'property:update',
    property_id: propertyId
  });

  emitPropertiesChanged({
    action: metadata.eventAction || metadata.action || 'update',
    property_id: propertyId,
    property: clone(persistedProperty)
  });

  return clone(persistedProperty);
}

export function deactivateProperty(propertyId, metadata = {}) {
  return updateProperty(
    propertyId,
    { status: 'inactive' },
    {
      ...metadata,
      action: metadata.action || 'property:deactivate',
      eventAction: metadata.eventAction || 'deactivate'
    }
  );
}

export async function deactivatePropertiesByCustomer(customerId, metadata = {}) {
  const state = readState();
  const sourceProperties = isProductionMode()
    ? await readSupabaseProperties(await resolveRepositoryCompanyId())
    : (state.properties || []);
  const deactivatedProperties = [];

  const nextProperties = (requireRemoteResult(sourceProperties, 'Production property read failed.') || []).map((property) => {
    if (property.customer_id !== customerId) return property;
    const updatedProperty = {
      ...property,
      status: 'inactive'
    };
    deactivatedProperties.push(updatedProperty);
    return updatedProperty;
  });

  const persistedDeactivatedProperties = deactivatedProperties.length
    ? (requireRemoteResult(
        await writeSupabaseProperties(deactivatedProperties),
        'Production property deactivate failed.'
      ) || deactivatedProperties)
    : [];
  const persistedById = new Map(persistedDeactivatedProperties.map((property) => [
    property.property_id,
    property
  ]));
  const persistedProperties = nextProperties.map((property) => (
    persistedById.get(property.property_id) || property
  ));

  writeLocalProperties(persistedProperties, {
    ...metadata,
    action: metadata.action || 'property:deactivate-by-customer',
    customer_id: customerId,
    property_ids: persistedDeactivatedProperties.map((property) => property.property_id)
  });

  emitPropertiesChanged({
    action: metadata.eventAction || 'deactivate-by-customer',
    customer_id: customerId,
    property_ids: persistedDeactivatedProperties.map((property) => property.property_id),
    properties: clone(persistedDeactivatedProperties)
  });

  return clone(persistedDeactivatedProperties);
}

export function updatePropertyFrequency(propertyId, recurringFrequency) {
  return updateProperty(
    propertyId,
    { recurring_frequency: recurringFrequency },
    {
      action: 'property:update-frequency',
      eventAction: 'update-frequency'
    }
  );
}

export function updatePropertyPrice(propertyId, defaultPrice) {
  return updateProperty(
    propertyId,
    { default_price: defaultPrice },
    {
      action: 'property:update-price',
      eventAction: 'update-price'
    }
  );
}

export function updateRecurringSchedule(propertyId, recurringSchedule) {
  return updateProperty(
    propertyId,
    { recurring_schedule: recurringSchedule },
    {
      action: 'property:update-recurring-schedule',
      eventAction: 'update-recurring-schedule'
    }
  );
}

export function pausePropertyService(propertyId) {
  return deactivateProperty(propertyId, {
    action: 'property:pause-service',
    eventAction: 'pause-service'
  });
}

export function removePropertyService(propertyId) {
  return deactivateProperty(propertyId, {
    action: 'property:remove-service',
    eventAction: 'remove-service'
  });
}

export function updateAccessInfo(propertyId, patch = {}) {
  const accessInfoPatch = ACCESS_INFO_FIELDS.reduce((nextPatch, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      nextPatch[field] = patch[field];
    }
    return nextPatch;
  }, {});

  return updateProperty(
    propertyId,
    accessInfoPatch,
    {
      action: 'property:update-access-info',
      eventAction: 'update-access-info'
    }
  );
}
