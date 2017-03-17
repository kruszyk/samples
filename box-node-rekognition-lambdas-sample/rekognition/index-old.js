/**
 * This sample shows how to connect a Box webhook to an AWS Lambda function via API Gateway.
 *
 * Each time an event occurs that triggers the webhook on Box, the Lambda function will be called with the details
 * of the event. The messages are secured with a message signature that is validated in the Lambda function.
 *
 * The sample Box test event is signed with the keys 'SamplePrimaryKey' and 'SampleSecondaryKey'.
 * To process events from your Box application, replace these keys with your keys (from the Box developer console),
 * configure the API Gateway to have 'Open' security and create a Box webhook that specifies your API Gateway URL
 * (from the Triggers tab).
 *
 * For step-by-step instructions, see box-node-webhook-to-lambda-sample in https://github.com/box/samples
 */

'use strict';

const BoxSDK = require('box-node-sdk');
const fs = require('fs');

var AWS = require('aws-sdk');
console.log('Access Key id: ' + process.env.BOX_AWS_ACCESS_KEY_ID)
console.log('Access secret: ' + process.env.BOX_AWS_SECRET_ACCESS_KEY)
console.log('AWS Region: ' + process.env.BOX_AWS_REGION)

AWS.config.update({
    'accessKeyId': process.env.BOX_AWS_ACCESS_KEY_ID,
    'secretAccessKey': process.env.BOX_AWS_SECRET_ACCESS_KEY,
    'region': process.env.BOX_AWS_REGION
});

var rekognition = new AWS.Rekognition({apiVersion: '2016-06-27'});

const privateKeyPath = `${process.env.LAMBDA_TASK_ROOT}/private_key.pem`;
const privateKey = fs.readFileSync(privateKeyPath);

var sdk = new BoxSDK({
    clientID: process.env.BOX_CLIENT_ID,
    clientSecret: process.env.BOX_CLIENT_SECRET,
    appAuth: {
        keyID: process.env.BOX_PUBLIC_KEY_ID,
        privateKey: privateKey,
        passphrase: process.env.BOX_PRIVATE_KEY_PASSPHRASE 
    }
});

// var client = sdk.getBasicClient(token);
var client = sdk.getAppAuthClient('enterprise', process.env.BOX_ENTERPRISE_ID);
client.asUser(process.env.BOX_APP_USER_ID);

/**
 * The event handler validates the message using the signing keys to ensure that the message was sent from
 * your Box application.
 */
exports.handler = (event, context, callback) => {

    console.log(JSON.stringify(event, null, 2));
    //Reads only one record as this sample configuration sets dynamodb batch size as 1.
    event.Records.forEach(function(record) {
        var fileId = record.dynamodb.Keys.file_id.S;

        console.log(fileId);

        var response = readStream(fileId);
        if (response.type === 'error') {
            callback(response.error);
        }

        response = detectLabels(fileId, response.data);
        if (response.type === 'error') {
            callback(response.error);
        }

        response = addMetadata(fileId, response.data);
        if (response.type === 'error') {
            callback(response.error);
        }

        callback(response.data);
    });
};

var detectLabels = function(fileId, buffer) {

    var params = {
        Image: {
            Bytes: buffer
        },
        MinConfidence: 50  
    };

    rekognition.detectLabels(params, (error, response) => {
        if (error) {
            console.log(error, error.stack); // an error occurred
            return {
                type: 'error',
                error: error 
            };
        } else {
            console.log("-------- START: Object and scene detection --------");
            var labels = response.Labels;
            var data = {};
            for(var i=0; i<labels.length; i++) {
                console.log("Name ="+labels[i].Name+", Confidence ="+labels[i].Confidence);  
                data[labels[i].Name] = labels[i].Confidence + '';
            }
            console.log("-------- END: Object and scene detection --------");
            console.log("\n");
      
            return {
                type: 'data',
                data: data
            };
        }
    })
}

var readStream = function(fileId) {
    console.log("File ID: " + fileId);
    client.files.getReadStream(fileId, null, (error, stream) => {
        if (error) {
            console.log(`Error occured: ${error}`);
            return {
                type: 'error',
                error: error 
            };
        }
      
        console.log(`Box Streaming data for file ${fileId}`);
        var buffer = new Buffer('', 'base64');
        stream.on('data', (chunk) => {
            console.log(`Chunk length: ${chunk.length}`);
            buffer = Buffer.concat([buffer, chunk]);
            
            console.log(buffer.length);
        });

        stream.on('end', () => {
            //buffer contains the file data
            return {
                type: 'data',
                data: buffer
            };
        });
    });
}

var addMetadata = function(fileId, metadata) {
    console.log(`Adding metadata: ${metadata}`);
    client.files.addMetadata(fileId, 'global', 'properties', metadata, function(error, data) {
        if (error) {
            console.log(`Error occured: ${error}`);
            return {
                type: 'error',
                error: error
            };
        } else {
            console.log(`Add Metadata is successful. ${data}`);
            return response = {
                type: 'data',
                data: data
            };
        }
    });
}