const companyId = 'co_lawn_001';

export const seedData = {
  company: {
    company_id: companyId,
    name: 'GreenEdge Lawn & Maintenance',
    created_at: '2026-01-01T08:00:00.000Z'
  },
  settings: {
    settings_id: 'settings_001',
    company_id: companyId,
    invoice_prefix: 'SBI',
    default_due_days: 15,
    tax_rate: 0.07,
    created_at: '2026-01-01T08:00:00.000Z'
  },
  customers: [
    {
      customer_id: 'cust_001',
      company_id: companyId,
      name: 'Oak Ridge HOA',
      phone: '555-0101',
      email: 'billing@oakridgehoa.com',
      billing_address: '221 Oak Ridge Blvd, Franklin, TN',
      notes: 'Needs invoice copy on first of month.',
      status: 'active',
      created_at: '2026-01-03T09:00:00.000Z'
    },
    {
      customer_id: 'cust_002',
      company_id: companyId,
      name: 'Miller Family',
      phone: '555-0102',
      email: 'miller.home@example.com',
      billing_address: '44 Cypress Ln, Franklin, TN',
      notes: 'Gate code 8421.',
      status: 'active',
      created_at: '2026-01-05T10:00:00.000Z'
    },
    {
      customer_id: 'cust_003',
      company_id: companyId,
      name: 'Sunrise Retail Plaza',
      phone: '555-0103',
      email: 'ap@sunriseplaza.com',
      billing_address: '778 Commerce Dr, Brentwood, TN',
      notes: 'Monthly net 15 terms.',
      status: 'active',
      created_at: '2026-01-06T10:30:00.000Z'
    },
    {
      customer_id: 'cust_004',
      company_id: companyId,
      name: 'Riverfront Condos',
      phone: '555-0104',
      email: 'manager@riverfrontcondos.com',
      billing_address: '18 Riverfront Way, Nashville, TN',
      notes: 'Call ahead before snow event service.',
      status: 'active',
      created_at: '2026-01-08T11:15:00.000Z'
    },
    {
      customer_id: 'cust_005',
      company_id: companyId,
      name: 'Parker Office Suites',
      phone: '555-0105',
      email: 'office@parkersuites.com',
      billing_address: '900 Maple Ave, Franklin, TN',
      notes: 'Include service notes each visit.',
      status: 'inactive',
      created_at: '2026-01-10T13:45:00.000Z'
    }
  ],
  properties: [
    {
      property_id: 'prop_001',
      company_id: companyId,
      customer_id: 'cust_001',
      service_address: '221 Oak Ridge Blvd Common Areas, Franklin, TN',
      service_type: 'Lawn Care',
      recurring_frequency: 'weekly',
      default_price: 180,
      notes: 'Front entrance and clubhouse grounds.',
      status: 'active',
      created_at: '2026-01-03T09:05:00.000Z'
    },
    {
      property_id: 'prop_002',
      company_id: companyId,
      customer_id: 'cust_001',
      service_address: 'Oak Ridge Pool Area, Franklin, TN',
      service_type: 'Maintenance',
      recurring_frequency: 'biweekly',
      default_price: 120,
      notes: 'Blow leaves and trim shrubs.',
      status: 'active',
      created_at: '2026-01-03T09:07:00.000Z'
    },
    {
      property_id: 'prop_003',
      company_id: companyId,
      customer_id: 'cust_002',
      service_address: '44 Cypress Ln, Franklin, TN',
      service_type: 'Lawn Care',
      recurring_frequency: 'weekly',
      default_price: 75,
      notes: 'Backyard first then front.',
      status: 'active',
      created_at: '2026-01-05T10:10:00.000Z'
    },
    {
      property_id: 'prop_004',
      company_id: companyId,
      customer_id: 'cust_003',
      service_address: '778 Commerce Dr Frontage, Brentwood, TN',
      service_type: 'Lawn Care',
      recurring_frequency: 'weekly',
      default_price: 215,
      notes: 'Commercial frontage and parking islands.',
      status: 'active',
      created_at: '2026-01-06T10:35:00.000Z'
    },
    {
      property_id: 'prop_005',
      company_id: companyId,
      customer_id: 'cust_003',
      service_address: '778 Commerce Dr Rear Lot, Brentwood, TN',
      service_type: 'Window Cleaning',
      recurring_frequency: 'monthly',
      default_price: 140,
      notes: 'Ground level only.',
      status: 'active',
      created_at: '2026-01-06T10:40:00.000Z'
    },
    {
      property_id: 'prop_006',
      company_id: companyId,
      customer_id: 'cust_004',
      service_address: '18 Riverfront Way, Nashville, TN',
      service_type: 'Snow Removal',
      recurring_frequency: 'one-time',
      default_price: 300,
      notes: 'Salt sidewalks and entry ramps.',
      status: 'active',
      created_at: '2026-01-08T11:20:00.000Z'
    },
    {
      property_id: 'prop_007',
      company_id: companyId,
      customer_id: 'cust_004',
      service_address: 'Riverfront Garage Access, Nashville, TN',
      service_type: 'Maintenance',
      recurring_frequency: 'weekly',
      default_price: 90,
      notes: 'Debris cleanup by loading dock.',
      status: 'active',
      created_at: '2026-01-08T11:25:00.000Z'
    },
    {
      property_id: 'prop_008',
      company_id: companyId,
      customer_id: 'cust_005',
      service_address: '900 Maple Ave, Franklin, TN',
      service_type: 'Lawn Care',
      recurring_frequency: 'weekly',
      default_price: 95,
      notes: 'Inactive account; service paused.',
      status: 'inactive',
      created_at: '2026-01-10T13:50:00.000Z'
    }
  ],
  visits: [
    {
      visit_id: 'visit_001',
      company_id: companyId,
      property_id: 'prop_001',
      visit_date: '2026-04-03',
      service_description: 'Weekly mow and edging',
      price: 180,
      status: 'completed',
      notes: 'All good.',
      created_at: '2026-04-03T17:00:00.000Z'
    },
    {
      visit_id: 'visit_002',
      company_id: companyId,
      property_id: 'prop_001',
      visit_date: '2026-04-10',
      service_description: 'Weekly mow and edging',
      price: 180,
      status: 'completed',
      notes: 'Trimmed near mailbox.',
      created_at: '2026-04-10T17:00:00.000Z'
    },
    {
      visit_id: 'visit_003',
      company_id: companyId,
      property_id: 'prop_003',
      visit_date: '2026-04-09',
      service_description: 'Weekly lawn service',
      price: 75,
      status: 'completed',
      notes: 'Bagged clippings.',
      created_at: '2026-04-09T15:00:00.000Z'
    },
    {
      visit_id: 'visit_004',
      company_id: companyId,
      property_id: 'prop_004',
      visit_date: '2026-04-08',
      service_description: 'Commercial weekly mow',
      price: 215,
      status: 'completed',
      notes: 'Irrigation heads checked.',
      created_at: '2026-04-08T18:00:00.000Z'
    },
    {
      visit_id: 'visit_005',
      company_id: companyId,
      property_id: 'prop_007',
      visit_date: '2026-04-11',
      service_description: 'Dock debris cleanup',
      price: 90,
      status: 'completed',
      notes: 'Two bags removed.',
      created_at: '2026-04-11T14:00:00.000Z'
    },
    {
      visit_id: 'visit_006',
      company_id: companyId,
      property_id: 'prop_005',
      visit_date: '2026-04-05',
      service_description: 'Monthly storefront windows',
      price: 140,
      status: 'billed',
      notes: 'Completed before open.',
      created_at: '2026-04-05T12:00:00.000Z'
    },
    {
      visit_id: 'visit_007',
      company_id: companyId,
      property_id: 'prop_006',
      visit_date: '2026-02-16',
      service_description: 'Snow event clearing',
      price: 300,
      status: 'billed',
      notes: 'Invoice sent same day.',
      created_at: '2026-02-16T19:00:00.000Z'
    },
    {
      visit_id: 'visit_008',
      company_id: companyId,
      property_id: 'prop_002',
      visit_date: '2026-04-12',
      service_description: 'Biweekly shrubs and leaf blow',
      price: 120,
      status: 'scheduled',
      notes: 'Planned route stop.',
      created_at: '2026-04-11T09:00:00.000Z'
    }
  ],
  invoices: [
    {
      invoice_id: 'inv_001',
      company_id: companyId,
      customer_id: 'cust_003',
      invoice_number: 'SBI-2026-0007',
      invoice_date: '2026-04-06',
      due_date: '2026-04-21',
      line_items: [
        {
          visit_id: 'visit_006',
          property_id: 'prop_005',
          description: 'Monthly storefront windows (2026-04-05)',
          amount: 140
        }
      ],
      subtotal: 140,
      tax: 9.8,
      total: 149.8,
      payment_status: 'partial',
      amount_paid: 75,
      created_at: '2026-04-06T09:00:00.000Z'
    },
    {
      invoice_id: 'inv_002',
      company_id: companyId,
      customer_id: 'cust_004',
      invoice_number: 'SBI-2026-0003',
      invoice_date: '2026-02-16',
      due_date: '2026-03-02',
      line_items: [
        {
          visit_id: 'visit_007',
          property_id: 'prop_006',
          description: 'Snow event clearing (2026-02-16)',
          amount: 300
        }
      ],
      subtotal: 300,
      tax: 21,
      total: 321,
      payment_status: 'overdue',
      amount_paid: 0,
      created_at: '2026-02-16T20:00:00.000Z'
    }
  ],
  payments: [
    {
      payment_id: 'pay_001',
      company_id: companyId,
      invoice_id: 'inv_001',
      amount: 75,
      payment_date: '2026-04-15',
      method: 'check',
      notes: 'Partial payment by mail.',
      created_at: '2026-04-15T10:00:00.000Z'
    }
  ]
};
