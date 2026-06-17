import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const ACCESS_INFO_FIELDS = ['gate_code', 'access_notes', 'parking_notes', 'hazards'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makePropertyId() {
  return `prop_${crypto.randomUUID().slice(0, 8)}`;
}

function emitPropertiesChanged(payload) {
  emit('properties:changed', payload);
}

export function listProperties() {
  return clone(readState().properties || []);
}

export function getProperty(propertyId) {
  const property = (readState().properties || []).find((item) => item.property_id === propertyId);
  return cloneOrNull(property);
}

export function createProperty(propertyInput = {}) {
  const state = readState();
  const property = {
    property_id: propertyInput.property_id || makePropertyId(),
    company_id: propertyInput.company_id || state.company?.company_id,
    customer_id: propertyInput.customer_id,
    service_address: propertyInput.service_address,
    service_type: propertyInput.service_type,
    recurring_frequency: propertyInput.recurring_frequency,
    default_price: propertyInput.default_price,
    status: propertyInput.status || 'active',
    notes: propertyInput.notes || '',
    created_at: propertyInput.created_at || new Date().toISOString()
  };

  const nextState = {
    ...state,
    properties: [...(state.properties || []), property]
  };

  writeState(nextState, {
    action: 'property:create',
    property_id: property.property_id
  });

  emitPropertiesChanged({
    action: 'create',
    property_id: property.property_id,
    property: clone(property)
  });

  return clone(property);
}

export function updateProperty(propertyId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedProperty = null;

  const nextState = {
    ...state,
    properties: (state.properties || []).map((property) => {
      if (property.property_id !== propertyId) return property;
      updatedProperty = {
        ...property,
        ...patch
      };
      return updatedProperty;
    })
  };

  if (!updatedProperty) return null;

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'property:update',
    property_id: propertyId
  });

  emitPropertiesChanged({
    action: metadata.eventAction || metadata.action || 'update',
    property_id: propertyId,
    property: clone(updatedProperty)
  });

  return clone(updatedProperty);
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

export function deactivatePropertiesByCustomer(customerId, metadata = {}) {
  const state = readState();
  const deactivatedProperties = [];

  const nextState = {
    ...state,
    properties: (state.properties || []).map((property) => {
      if (property.customer_id !== customerId) return property;
      const updatedProperty = {
        ...property,
        status: 'inactive'
      };
      deactivatedProperties.push(updatedProperty);
      return updatedProperty;
    })
  };

  writeState(nextState, {
    ...metadata,
    action: metadata.action || 'property:deactivate-by-customer',
    customer_id: customerId,
    property_ids: deactivatedProperties.map((property) => property.property_id)
  });

  emitPropertiesChanged({
    action: metadata.eventAction || 'deactivate-by-customer',
    customer_id: customerId,
    property_ids: deactivatedProperties.map((property) => property.property_id),
    properties: clone(deactivatedProperties)
  });

  return clone(deactivatedProperties);
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
  const state = readState();
  let updatedProperty = null;

  const accessInfoPatch = ACCESS_INFO_FIELDS.reduce((nextPatch, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      nextPatch[field] = patch[field];
    }
    return nextPatch;
  }, {});

  const nextState = {
    ...state,
    properties: (state.properties || []).map((property) => {
      if (property.property_id !== propertyId) return property;
      updatedProperty = {
        ...property,
        ...accessInfoPatch
      };
      return updatedProperty;
    })
  };

  if (!updatedProperty) return null;

  writeState(nextState, {
    action: 'property:update-access-info',
    property_id: propertyId
  });

  emitPropertiesChanged({
    action: 'update-access-info',
    property_id: propertyId,
    property: clone(updatedProperty)
  });

  return clone(updatedProperty);
}
