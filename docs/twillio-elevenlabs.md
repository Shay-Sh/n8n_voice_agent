Sending generated audio through Twilio

Learn how to integrate generated speech into phone calls with Twilio.

In this guide, you’ll learn how to send an AI generated message through a phone call using Twilio and ElevenLabs. This process allows you to send high-quality voice messages directly to your callers.

Create accounts with Twilio and ngrok
We’ll be using Twilio and ngrok for this guide, so go ahead and create accounts with them.

twilio.com
ngrok.com
Get the code
If you want to get started quickly, you can get the entire code for this guide on GitHub

Create the server with Express
Initialize your project
Create a new folder for your project

mkdir elevenlabs-twilio
cd elevenlabs-twilio
npm init -y

Install dependencies
npm install elevenlabs express express-ws twilio

Install dev dependencies
npm i @types/node @types/express @types/express-ws @types/ws dotenv tsx typescript

Create your files
// src/app.ts
import 'dotenv/config';
import { ElevenLabsClient } from 'elevenlabs';
import express, { Response } from 'express';
import ExpressWs from 'express-ws';
import { Readable } from 'stream';
import VoiceResponse from 'twilio/lib/twiml/VoiceResponse';
import { type WebSocket } from 'ws';
const app = ExpressWs(express()).app;
const PORT: number = parseInt(process.env.PORT || '5000');
const elevenlabs = new ElevenLabsClient();
const voiceId = '21m00Tcm4TlvDq8ikWAM';
const outputFormat = 'ulaw_8000';
const text = 'This is a test. You can now hang up. Thank you.';
function startApp() {
  app.post('/call/incoming', (_, res: Response) => {
    const twiml = new VoiceResponse();
    twiml.connect().stream({
      url: `wss://${process.env.SERVER_DOMAIN}/call/connection`,
    });
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  });
  app.ws('/call/connection', (ws: WebSocket) => {
    ws.on('message', async (data: string) => {
      const message: {
        event: string;
        start?: { streamSid: string; callSid: string };
      } = JSON.parse(data);
      if (message.event === 'start' && message.start) {
        const streamSid = message.start.streamSid;
        const response = await elevenlabs.textToSpeech.convert(voiceId, {
          model_id: 'eleven_flash_v2_5',
          output_format: outputFormat,
          text,
        });
        const readableStream = Readable.from(response);
        const audioArrayBuffer = await streamToArrayBuffer(readableStream);
        ws.send(
          JSON.stringify({
            streamSid,
            event: 'media',
            media: {
              payload: Buffer.from(audioArrayBuffer as any).toString('base64'),
            },
          })
        );
      }
    });
    ws.on('error', console.error);
  });
  app.listen(PORT, () => {
    console.log(`Local: http://localhost:${PORT}`);
    console.log(`Remote: https://${process.env.SERVER_DOMAIN}`);
  });
}
function streamToArrayBuffer(readableStream: Readable) {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).buffer);
    });
    readableStream.on('error', reject);
  });
}
startApp();

# .env
SERVER_DOMAIN=
ELEVENLABS_API_KEY=

Understanding the code
Handling the incoming call
When you call your number, Twilio makes a POST request to your endpoint at /call/incoming. We then use twiml.connect to tell Twilio that we want to handle the call via our websocket by setting the url to our /call/connection endpoint.

function startApp() {
  app.post('/call/incoming', (_, res: Response) => {
    const twiml = new VoiceResponse();
    twiml.connect().stream({
      url: `wss://${process.env.SERVER_DOMAIN}/call/connection`,
    });
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  });

Creating the text to speech
Here we listen for messages that Twilio sends to our websocket endpoint. When we receive a start message event, we generate audio using the ElevenLabs TypeScript SDK.

  app.ws('/call/connection', (ws: WebSocket) => {
    ws.on('message', async (data: string) => {
      const message: {
        event: string;
        start?: { streamSid: string; callSid: string };
      } = JSON.parse(data);
      if (message.event === 'start' && message.start) {
        const streamSid = message.start.streamSid;
        const response = await elevenlabs.textToSpeech.convert(voiceId, {
          model_id: 'eleven_flash_v2_5',
          output_format: outputFormat,
          text,
        });

Sending the message
Upon receiving the audio back from ElevenLabs, we convert it to an array buffer and send the audio to Twilio via the websocket.

const readableStream = Readable.from(response);
const audioArrayBuffer = await streamToArrayBuffer(readableStream);
ws.send(
  JSON.stringify({
    streamSid,
    event: 'media',
    media: {
      payload: Buffer.from(audioArrayBuffer as any).toString('base64'),
    },
  })
);

Point ngrok to your application
Twilio requires a publicly accessible URL. We’ll use ngrok to forward the local port of our application and expose it as a public URL.

Run the following command in your terminal:

ngrok http 5000

Copy the ngrok domain (without https://) to use in your environment variables.


Update your environment variables
Update the .env file with your ngrok domain and ElevenLabs API key.

# .env
SERVER_DOMAIN=*******.ngrok.app
ELEVENLABS_API_KEY=*************************

Start the application
Run the following command to start the app:

npm run dev

Set up Twilio
Follow Twilio’s guides to create a new number. Once you’ve created your number, navigate to the “Configure” tab in Phone Numbers -> Manage -> Active numbers

In the “A call comes in” section, enter the full URL to your application (make sure to add the/call/incoming path):

E.g. https://***ngrok.app/call/incoming


Make a phone call
Make a call to your number. You should hear a message using the ElevenLabs voice.

Tips for deploying to production
When running the application in production, make sure to set the SERVER_DOMAIN environment variable to that of your server. Be sure to also update the URL in Twilio to point to your production server.

Conclusion
You should now have a basic understanding of integrating Twilio with ElevenLabs voices. If you have any further questions, or suggestions on how to improve this blog post, please feel free to select the “Suggest edits” or “Raise issue” button below.

Was this page helpful?
Yes
No

-----------------------

Twilio outbound calls

Build an outbound calling AI agent with Twilio and ElevenLabs.

In this guide you will learn how to build an integration with Twilio to initialise outbound calls to your prospects and customers.


Prefer to jump straight to the code?
Find the example project on GitHub.

What You’ll Need
An ElevenLabs account.
A configured ElevenLabs Conversational Agent (create one here).
A Twilio account with an active phone number.
Node.js 16+
ngrok for local development.
Agent Configuration
Before integrating with Twilio, you’ll need to configure your agent to use the correct audio format supported by Twilio.

1
Configure TTS Output
Navigate to your agent settings.
Go to the Voice section.
Select “μ-law 8000 Hz” from the dropdown.

2
Set Input Format
Navigate to your agent settings. 2. Go to the Advanced section. 3. Select “μ-law 8000 Hz” for the input format.

3
Enable auth and overrides
Navigate to your agent settings.
Go to the security section.
Toggle on “Enable authentication”.
In “Enable overrides” toggle on “First message” and “System prompt” as you will be dynamically injecting these values when initiating the call.

Implementation
Javascript
Looking for a complete example? Check out this Javascript implementation on GitHub.

1
Initialize the Project
First, set up a new Node.js project:

mkdir conversational-ai-twilio
cd conversational-ai-twilio
npm init -y; npm pkg set type="module";

2
Install dependencies
Next, install the required dependencies for the project.

npm install @fastify/formbody @fastify/websocket dotenv fastify ws twilio

3
Create the project files
Create a .env and outbound.js file with the following code:


.env

outbound.js

ELEVENLABS_AGENT_ID=<your-agent-id>
ELEVENLABS_API_KEY=<your-api-key>
# Twilio
TWILIO_ACCOUNT_SID=<your-account-sid>
TWILIO_AUTH_TOKEN=<your-auth-token>
TWILIO_PHONE_NUMBER=<your-twilio-phone-number>
4
Run the server
You can now run the server with the following command:

node outbound.js

If the server starts successfully, you should see the message [Server] Listening on port 8000 (or the port you specified) in your terminal.

Testing
In another terminal, run ngrok http --url=<your-url-here> 8000.
Make a request to the /outbound-call endpoint with the customer’s phone number, the first message you want to use and the custom prompt:
curl -X POST https://<your-ngrok-url>/outbound-call \
-H "Content-Type: application/json" \
-d '{
    "prompt": "You are Eric, an outbound car sales agent. You are calling to sell a new car to the customer. Be friendly and professional and answer all questions.",
    "first_message": "Hello Thor, my name is Eric, I heard you were looking for a new car! What model and color are you looking for?",
    "number": "number-to-call"
    }'

You will see the call get initiated in your server terminal window and your phone will ring, starting the conversation once you answer.
Troubleshooting
Connection Issues
If the WebSocket connection fails:

Verify your ngrok URL is correct in Twilio settings
Check that your server is running and accessible
Ensure your firewall isn’t blocking WebSocket connections
Audio Problems
If there’s no audio output:

Confirm your ElevenLabs API key is valid
Verify the AGENT_ID is correct
Check audio format settings match Twilio’s requirements (μ-law 8kHz)
Security Best Practices
Follow these security guidelines for production deployments:

Use environment variables for sensitive information - Implement proper authentication for your endpoints - Use HTTPS for all communications - Regularly rotate API keys - Monitor usage to prevent abuse

Walkthrough Video Transcript:
Intro: Outbound AI Phone Agent Demo
0:00
today let's automate some outbound
0:03
calling using twilio and 11 laps
0:07
conversational AI so here let's jump
0:10
into a little demo so I just put in my
0:14
phone
0:16
number so let's have a look over in our
Website to Server Log
0:19
server here so we're now going to pick
0:22
up the
AI Demo: Outbound Call
0:24
call hello Peter my name is Thor I heard
0:27
you're interested to learn more about 11
0:30
Labs can I tell you a bit about what we
0:32
do yeah Thor well thanks for the call
0:36
yeah tell me
0:39
more great 11lb specializes in high
0:42
quality text to speeech and voice
0:44
cloning technology we strive to make
0:46
content more accessible and engaging
0:49
with realistic and versatile AI voices
0:52
we can either convert written text into
0:55
spoken audio or voice that sounds like
0:58
you or I'm Thor a developer experience
1:02
engineer at 11 Labs I help developers
1:05
like yourself understand and Implement
1:08
our technology what are you hoping to
1:10
achieve with 11
1:12
Labs there we go and you might have
1:15
recognized that that was actually my
1:18
voice so that is another capability that
1:21
11 laps has is you can create realistic
1:25
voice clones of yourself and then
1:27
actually use them in your conversational
1:29
AI
1:30
agents so you can see here that we're
1:33
getting a bunch of logging in we're
1:35
getting the transcript of um the user uh
1:39
here the user transcript uh we're also
1:42
getting the agent response uh and you
1:44
can see here that we have some start
1:47
parameters that we fed in so um we have
1:50
a custom prompt here that says your Thor
1:53
developer experience engineer at 11 Labs
1:56
um you're calling to tell them about you
1:58
know 11 labs and any questions they have
2:01
and then the first message so I was
2:03
pretending to be Peter here hello Peter
2:06
my name is Thor and so you can see this
2:08
is how you can initiate outbound calls
Agent Configuration: Integration Details
2:11
now let's have a look at how that
2:13
integration looks like so first of all
2:16
when we hop over into the docs we can
2:18
see kind of our requirements we need an
2:21
11 laps account um we need a
2:24
conversational AI agent and we need a
2:27
twily account with an active phone
2:28
number so here we're in this example
2:31
we're working with node.js so just above
2:34
version 16 and then also enro for local
2:37
development if we don't have our server
2:40
um deployed just yet so in terms of the
2:43
agent configuration so there's a couple
2:45
things that we need to consider in order
2:48
to make this work with twilio um
2:51
specifically here kind of the text to
2:53
speech output
2:55
format so if we look into our agent here
2:58
so we can see um we've configured kind
3:00
of our agent language so the first
3:03
message here in the system prompt you
3:04
can see so we've overwritten that in our
3:08
integration uh we're using Gemini 2.0
3:11
flash as our um model here you can see
3:14
it's very Snappy uh in terms of the the
3:17
response time so that's great and um you
3:20
know there's a bunch of settings that we
3:22
can do especially also tool call so you
3:25
know if you want to give access to
3:27
specific knowledge base you can do that
3:29
here as well in kind of a no code manner
3:32
um but then also you can specify uh
3:34
client side as well as server side tools
3:38
um so in this integration we'd be kind
3:39
of using server side tools where then
3:42
the agent can call back to your API to
3:44
get additional uh information for
3:46
example you know about inventory
3:49
knowledge or you know schedule a call in
3:53
in cal.com you know there's kind of uh
3:55
tons of Integrations that you can do
3:57
here so in terms of the voice
3:59
configuration you can see that I used my
4:03
uh tosen German engineer voice clone
4:05
here um so that is that is great and
4:08
then you can see here that is the output
4:10
format um that we need to specify for
4:14
this to work with twilio okay and so at
4:18
this point uh we still need to go over
4:20
into the security tab so because we want
4:24
to override you know the first message
4:26
and the system prompt we do want to
4:28
enable authentic indication here so
4:30
we're using assigned uh URL to connect
4:33
to our agent um you know you can also
4:36
embed this uh agent into a widget um and
4:40
so since kind of authentication is
4:42
enabled here um that wouldn't be
4:45
possible you know to override kind of in
4:47
in um you know the first me and the
4:50
system prompt because you wouldn't want
4:52
that to be overwritten by the user kind
4:54
of in the client application okay great
Server Integration: Code Overview
4:57
so let's have a look at what this looks
4:59
like kind of in your server integration
5:02
so this is just a simple JavaScript
5:05
node.js example where we're using
5:07
fastify and um websockets and so we can
5:11
look
5:12
at the things we need here so there's a
5:14
bunch of environment variables that we
5:16
need we need our 11 laps API key that we
5:19
can get from um our account here in the
5:22
API Keys we also need our agent ID that
5:26
is that one here and we need to set that
5:28
up in Ure um serers side environment
5:32
variables um then the twio account uh s
5:36
Sid twio off token to your phone number
5:39
so these are the configurations that you
5:41
need to initiate the the outbound
5:44
calling uh and then here specifically so
5:47
in my application I have my front end um
5:50
you know in in a different location as
5:52
my back end so I will need to facilitate
5:55
course headers now if you're doing this
5:57
in a production kind of environment you
5:58
of course need to to make sure that you
6:01
secure your API and you know especially
6:04
here this API is accepting um The Prompt
6:08
and the first message as um you know uh
6:13
parameters uh so you want to make sure
6:15
that you lock that down accordingly uh
6:18
and then you can see we just have some
6:20
um helper methods here so specifically
6:22
to get the signed URL so that is for the
6:25
authentication we have our twio client
6:28
as well um and then you can see here um
6:31
this is kind of where we start so if we
6:34
look back into um kind of our requests
6:37
that were coming in uh so you can see
6:40
here so we had this outbound call that
6:43
was initializing the call then there was
6:45
a call happening to the outbound call uh
6:49
twiml and then the outbound media stream
6:52
which is our our websocket connection so
6:55
let's step through these um different
6:58
components in in detail so the outbound
7:02
call so this is what initializes the
7:04
call so here we get the number The
7:07
Prompt and the first message out um you
7:10
know obviously you could also just
7:12
accept the phone number and then do a
7:14
lookup in your database to you know get
7:17
kind of fill in uh the information for
7:19
the prompt in the first message like you
7:20
know their name to know okay this phone
7:23
number belongs to to Peter um for
7:26
example and then what we're doing is
7:27
we're using the twillo client to create
7:30
a call um and specifically we're uh
7:34
telling here for the call um this is
7:36
where we get our tml kind of the
7:39
basically the instructions for um you
7:42
know twio of like how to initialize the
7:44
call and so you can see here we're
7:46
encoding The Prompt and the first
7:49
message um into our outbound call uh
7:53
twiml so um we can see here then we get
7:57
the call initiated so that is what we
7:59
were returning back to our front end so
8:01
the next call is from twio then to this
8:05
API roundout outbound call twiml so here
8:08
we're reading out kind of the prompt and
8:11
the first message from the uh request
8:14
parameters and then we're putting
8:15
together our tml response um and so
8:19
specifically this is the response where
8:20
we're saying we want to connect to a
8:23
websocket
8:24
stream and so our websocket stream is
8:27
this here uh on on the same um you know
8:31
host to the outbound media stream
8:35
endpoint uh and then we're passing in
8:37
these custom parameters in in um the
8:40
twiml where we pass in the prompt and
8:43
the first message and so this response
8:45
we're giving back to twilio and so now
8:48
twio knows okay we want to uh connect to
8:53
this stream web circuit stream uh here
8:56
the outbound media and so you can see
8:59
this is websocket true so this is in
9:01
fastify how we can uh easily set up a
9:04
websocket and you can see here okay
9:07
connect to outbound media stream uh and
9:10
then we can get out kind of a couple um
9:12
variables here like the stream Sid the
9:15
call Sid um and then we're setting up
9:18
kind of our 11 laps websocket and we
9:21
need our custom
9:22
parameters um so our websocket uh we can
9:26
listen to kind of a couple different
9:28
things here so we have a method we want
9:30
to set up our 11lbs um web socket so
9:34
first thing we need to do is we need to
9:36
get our signed URL so that's you know we
9:38
enabled authentication we want to
9:40
override the initial kind of
9:42
conversation configuration um so we need
9:45
a signed URL and then we're creating a
9:48
new websocket to our conversational AI
9:51
agent so once our websocket is open we
9:56
then um see here we put together our
9:59
initial configuration with our custom
10:02
parameters um and we can see how we're
10:05
setting the custom parameters later on
10:08
uh and so the initial config we just
10:10
then need to send over um so here in the
10:15
uh over on the websocket so on the uh
10:18
websocket with our signed URL we're then
10:20
sending this as um a Json stringified
10:24
message and so you can see here that
10:27
we're uh listening to our message
10:29
messages so this is where we're kind of
10:31
switching through the different um
10:33
message types so if we have um kind of
10:36
an audio message then we're you know
10:39
reading out kind of the audio junk um
10:42
and we're you know just putting together
10:44
our audio
10:45
data um and then you know this is
10:49
basically facilitating kind of the
10:51
encoding of the audio between you know
10:55
our phone uh and the conversational AI
10:58
agent uh over the websocket we're also
11:01
handling kind of the interruptions here
11:04
um there is a ping kind of Handler as
11:07
well that that we need to set up uh and
11:10
then you can see here there's a couple
11:11
cases like the agent response event um
11:15
that we can see okay what is the the
11:18
agent kind of responding with and then
11:21
also the user transcript so we can see
11:24
you know as we're speaking um where we
11:26
have kind of the automatic speech
11:28
recognition and we're transcribing what
11:31
you know the user is saying on their
11:32
phone uh and then that is being fed into
11:35
our Gemini 2.0 flash our model uh to
11:39
then you know generate you know that is
11:41
our brain so Gemini is our brain and
11:43
then in a response we see the the agent
11:46
response here um yeah and that is pretty
11:50
much it we just have a couple other
11:52
handlers you know error kind of close uh
11:55
handlers and then once we have that you
11:57
know we're setting up uh our websocket
12:00
and
12:01
so um you can see that we have kind of
12:04
two different websockets right so one is
12:07
the websocket connection that is coming
12:09
in from uh twilio this is our outborn
12:12
media stream we websocket and then we're
12:15
setting up another websocket to so this
12:18
is basically our inbound kind of
12:21
websocket coming from you know twio to
12:24
to us so to speak uh and then we have
12:27
kind of our outbound web so which is the
12:30
uh web soet from our integration to the
12:33
conversational AI agent and so we're
12:36
facilitating kind of the communication
12:38
between these two websockets here and so
12:41
you can see that like when we have a
12:43
message from twio we get kind of a
12:45
twilio event received we can check that
12:48
here um so here this is our start uh
12:51
message so in that case um you know
12:54
twilio is initializing um our start with
12:58
the custom parameters so this is where
13:01
we can get out the custom parameters
13:03
from twilio where we're getting our um
13:06
prompt and our first message so this is
13:09
how we're setting up um our our uh you
13:12
know custom outbound calling so that the
13:15
conversational agent knows that once
13:18
we're starting the connection uh you
13:20
know they should say hi I'm Peter I
13:22
heard that you're uh interested no sorry
13:25
hi I'm Thor hi Peter I'm Thor I heard
13:27
you're interested in 11 Labs you know
13:30
let me tell you more uh and then we need
13:33
to handle kind of the media um event
13:36
here as well as the stop event so that
13:39
you know if they hang up the phone we
13:41
then clean up kind of all the um
13:43
conversations we close out our uh you
13:46
know connection to the conversational AI
13:50
agent um here and so that is pretty much
13:53
all we need then we just need to start
13:55
up the fastify server to serve that and
13:59
um and so that is how we're up and
14:02
running uh and that is kind of how we
14:05
can Implement um outbound calling with
14:09
twilio so you can follow along the
14:11
documentation I will link it below as
14:13
well to help you kind of with a
14:15
stepbystep configuration um you can find
14:19
the exact code that I was showing here
14:21
on GitHub as well um or you can follow
14:24
along here to you know find how to set
14:27
up your code it's in the documentation
14:31
uh and then for testing here you can use
14:33
enr or you know you can deploy your
14:36
server to you know any kind of Hosting
14:38
provider uh just make sure that as
14:41
you're um you know putting that into
14:43
production you're properly uh using
14:46
https you're you're you know locking
14:49
down your environment to make sure that
14:51
only your um integration can actually
14:54
call um the server and initiate the
14:57
calls um but yeah yeah that is pretty
14:59
much it that is how you can get started
15:01
with outbound calling and build your you
15:04
know outbound sales agents using twilio
15:08
and 11 laps let us know what else you
15:11
want to learn about and I will see you
15:13
