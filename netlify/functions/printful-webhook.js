// netlify/functions/printful-webhook.js

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the webhook payload from Printful v2
    const payload = JSON.parse(event.body);
    
    console.log('Received webhook:', payload);

    // V2 API uses 'type' field for event type
    if (payload.type !== 'shipment_sent') {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Event type not handled' })
      };
    }

    // Extract shipment and order details from v2 structure
    const shipment = payload.data;
    const order = shipment.order || {};
    
    const customerEmail = order.recipient?.email;
    const customerName = order.recipient?.name;
    const orderNumber = order.external_id || order.id;
    const trackingNumber = shipment.tracking_number;
    const trackingUrl = shipment.tracking_url;
    const carrier = shipment.carrier;
    
    // Extract shipped items
    const shippedItems = shipment.shipment_items || [];
    const itemsList = shippedItems.map(item => {
      const quantity = item.quantity || 1;
      const name = item.order_item_name || 'Item';
      return `${quantity}x ${name}`;
    }).join(', ');
    
    const itemsCount = shippedItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

    if (!customerEmail) {
      console.error('No customer email found in webhook');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No customer email in payload' })
      };
    }

    // Get the group ID for "order-shipped" group
    const groupId = process.env.SENDER_GROUP_ID;

    if (!groupId) {
      console.error('SENDER_GROUP_ID not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: 'SENDER_GROUP_ID environment variable not set',
          note: 'Please add your Sender group ID to environment variables'
        })
      };
    }

    // STEP 1: First, remove user from the group (if they're in it)
    // This ensures the automation triggers again for repeat orders
    try {
      await fetch(`https://api.sender.net/v2/subscribers/${encodeURIComponent(customerEmail)}/groups/${groupId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
          'Accept': 'application/json'
        }
      });
      console.log('User removed from group (if they were in it)');
    } catch (removeError) {
      // It's okay if removal fails (user might not be in group)
      console.log('Remove from group result:', removeError.message);
    }

    // STEP 2: Update subscriber data with new order info
    const subscriberData = {
      email: customerEmail,
      firstname: customerName?.split(' ')[0] || '',
      lastname: customerName?.split(' ').slice(1).join(' ') || '',
      fields: {
        order_number: orderNumber,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        carrier: carrier,
        items_shipped: itemsList,
        items_count: itemsCount.toString(),
        last_shipment_date: new Date().toISOString()
      }
    };

    // Try to create or update the subscriber first
    const updateResponse = await fetch('https://api.sender.net/v2/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(subscriberData)
    });

    if (!updateResponse.ok && updateResponse.status !== 409) {
      const errorText = await updateResponse.text();
      console.error('Failed to create/update subscriber:', errorText);
    }

    // STEP 3: Add user back to the group (this triggers the automation)
    const addToGroupResponse = await fetch(`https://api.sender.net/v2/subscribers/${encodeURIComponent(customerEmail)}/groups`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        groups: [groupId]
      })
    });

    if (!addToGroupResponse.ok) {
      const errorText = await addToGroupResponse.text();
      console.error('Failed to add to group:', errorText);
      throw new Error(`Failed to add subscriber to group: ${addToGroupResponse.status} - ${errorText}`);
    }

    console.log('Subscriber added to order-shipped group successfully');
    const result = await addToGroupResponse.json().catch(() => ({}));
    console.log('Sender API response:', result);

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        message: 'Customer added to order-shipped group, automation will trigger',
        orderId: orderNumber,
        email: customerEmail,
        itemsCount: itemsCount
      })
    };

  } catch (error) {
    console.error('Error processing webhook:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to process webhook',
        message: error.message 
      })
    };
  }
};