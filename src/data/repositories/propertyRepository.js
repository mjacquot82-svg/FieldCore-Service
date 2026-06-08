import { emit } from '../appEventBus.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const ACCESS_INFO_FIELDS = ['gate_code', 'access_notes', 'parking_notes', 'hazards'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

export function listProperties() {
  return clone(readState().properties || []);
}

export function getProperty(propertyId) {
  const property = (readState().properties || []).find((item) => item.property_id === propertyId);
  return cloneOrNull(property);
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

  emit('properties:changed', {
    action: 'update-access-info',
    property_id: propertyId,
    property: clone(updatedProperty)
  });

  return clone(updatedProperty);
}
