exports.handler = async function(context, event, callback) {
    const { createResponse, success, error } = require(Runtime.getAssets()['/utils/response.js'].path);
    const { validateEmail } = require(Runtime.getAssets()['/utils/validation.js'].path);
    const ProviderFactory = require(Runtime.getAssets()['/providers/factory.js'].path);

    try {
        const twilio = require('twilio');
        const client = twilio(context.TWILIO_ACCOUNT_SID, context.TWILIO_AUTH_TOKEN);
        const db = ProviderFactory.getDatabase(context);

        if (!event.email) {
            throw new Error('Missing required field: email');
        }

        if (!validateEmail(event.email)) {
            throw new Error('Invalid email format');
        }

        const identity = `email:${event.email}`;
        const existingSession = await db.getSession(identity);
        const webhookUrl = `https://${context.FUNCTIONS_DOMAIN}/backend/log-sessions`;
        
        console.log('Webhook URL being used:', webhookUrl);
        console.log('Checking for existing session:', { identity, existingSession });

        let messageConfig;
        if (existingSession && event.response) {
            const rawSessionId = existingSession.get('session_id');
            const cleanSessionId = rawSessionId.replace('webhook:', '');
                
            messageConfig = {
                identity: identity,
                body: event.response,
                webhook: webhookUrl,
                session_id: cleanSessionId,
                mode: "email"
            };
        } else if (event.first_name && event.area_code) {
            const messageBody = `A new lead, named ${event.first_name}, was submitted and they are interested in properties in ${event.area_code}. ${event.interest ? `They provided the following additional information: "${event.interest}".` : ''} Write an email to them with some property recommendations based on their interests and ask if they would like to schedule time with an Owl Home Agent.`;
            
            messageConfig = {
                identity: identity,
                body: messageBody,
                webhook: webhookUrl,
                mode: "email"
            };
        } else {
            throw new Error('Invalid request: Must provide either response for existing conversation or new lead information (first_name and area_code)');
        }

        console.log('Full message config:', JSON.stringify(messageConfig, null, 2));

        const message = await client.assistants.v1
            .assistants(context.ASSISTANT_ID)
            .messages
            .create(messageConfig);

        console.log('Assistant response:', JSON.stringify(message, null, 2));

        return callback(null, createResponse(200, success({
            message_status: message.status,
            session_id: message.session_id,
            account_sid: message.account_sid,
            body: message.body,
            flagged: message.flagged,
            aborted: message.aborted
        })));

    } catch (err) {
        console.error('Error sending to assistant:', err);
        
        const statusCode = err.message.includes('Missing required') || 
                          err.message.includes('Invalid email') ? 400 : 500;

        return callback(null, createResponse(statusCode, error(
            err.message,
            statusCode,
            process.env.NODE_ENV === 'development' ? {
                stack: err.stack,
                code: err.code,
                status: err.status,
                more_info: err.more_info
            } : undefined
        )));
    }
};