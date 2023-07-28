var moduleId = "SSH";
var MESSAGE_SEND_DELAY 		= 2000;

var g_debug = Config.Get("DebugTrace") == "true";
var g_ssh;
var g_stateMachine = 0;

if (g_debug)
{
	System.Print(moduleId + ": Initializing SSH Uptime Driver\r\n");
	System.Print(moduleId + ": Firmware " + System.FirmwareVersion + "\r\n");
	System.Print(moduleId + ": Runtime " + System.Version + "\r\n");
	System.Print(moduleId + ": Version " + "1.1 (2020-12-11)" + "\r\n");
}

// queue
var g_txWait = false;
var g_cmdQueue = new Array();
var g_timer = new Timer();

// read settings from the driver config
var g_host = Config.Get("server");
var g_port = parseInt(Config.Get("port"),10);
var g_allowKey = parseInt(Config.Get("authentication"),10) == 2;

var g_username = Config.Get("username");
var g_password = Config.Get("password");

var g_privateKey = System.LoadResource("id_rsa");
var g_privateKeyPassword = Config.Get("password");

// clear sysvars
SystemVars.Write("TIME","");
SystemVars.Write("UPTIME","");
SystemVars.Write("USERS",0);
SystemVars.Write("LOAD","");

sshInit();

// end of init

dbgPrint("Initialization complete");

function dbgPrint(msg)
{
	if (g_debug)
		System.Print(moduleId + ": " + msg);
}

function sshUptime()
{
	dbgPrint("sshUptime()");
	addMessageToQueue("uptime");
}

// response handlers
function OnCommRx(message,handle)
{
	dbgPrint("OnCommRx() data = " + message);
	
	// parse the reply and update the sysvars
	//  09:26:18 up 10 days, 21:57,  1 user,  load average: 0.00, 0.00, 0.00
	//  09:53:05 up 10 days, 22:24,  2 users,  load average: 0.00, 0.00, 0.00
	//var result = message.match(/^ ?(.+) up (\d+ days, .+), +(\d+) user[s]?,  load average: (.+)$/m);
	//if (result !== null) 
	//{
		//SystemVars.Write("TIME",result[1]);
		//SystemVars.Write("UPTIME",result[2]);
		//SystemVars.Write("USERS",parseInt(result[3],10));
		//SystemVars.Write("LOAD",result[4]);
	//}
}

function OnConnect(handle) 
{
	dbgPrint("OnConnect() handle = 0x" + handle.toString(16));
	g_ssh.StartHandshake(g_username);
}

function OnConnectFailed(handle)
{
	dbgPrint("OnConnectFailed() handle = 0x" + handle.toString(16));
	g_connected = false;
}

function OnDisconnect(handle) 
{
	dbgPrint("OnDisconnect() handle = 0x" + handle.toString(16));
	g_connected = false;
}

function OnHandshakeOK(fingerprint,methods,handle)
{
	dbgPrint("OnHandshakeOK() fingerprint = ");
	dbgPrint(Util.toString(fingerprint,fingerprint.length,"HEXSTRINGLOWER"));
	dbgPrint("OnHandshakeOK() available authentication methods = " + methods);
	var available = methods.split(",");
	for (item in available)
	{
		if (g_allowKey)
		{
			if (available[item] == "publickey")
			{
				dbgPrint("OnHandshakeOK() authenticating with public key");
				g_ssh.AuthenticatePublicKey(g_privateKey,g_privateKeyPassword);
			}
		}
		else
		{
			if (available[item] == "password")
			{
				dbgPrint("OnHandshakeOK() authenticating with password");
				g_ssh.AuthenticatePassword(g_password);
			}
		}
	}
}

function OnHandshakeFailed(handle)
{
	dbgPrint("OnHandshakeFailed() handle = 0x" + handle.toString(16));
}

function OnAuthenticationOK(banner,handle)
{
	dbgPrint("OnAuthenticationOK() handle = 0x" + handle.toString(16));
	dbgPrint("OnAuthenticationOK() " + banner);
	sshUptime();
}

function OnAuthenticationFailed(handle)
{
	dbgPrint("OnAuthenticationFailed() handle = 0x" + handle.toString(16));
}

function sshInit()
{
	dbgPrint("sshInit()");
	System.OnShutdownFunc = systemShutdownFunction;
	
	dbgPrint("sshInit() connecting to: " + g_host + ":" + g_port);
	g_ssh = new SSH(OnCommRx,g_host,g_port);
	dbgPrint("sshInit() handle = 0x" + g_ssh.Handle.toString(16));
	g_ssh.OnConnectFunc = OnConnect;
	g_ssh.OnConnectFailedFunc = OnConnectFailed;
	g_ssh.OnDisconnectFunc = OnDisconnect;
	g_ssh.OnHandshakeOKFunc = OnHandshakeOK;
	g_ssh.OnHandshakeFailedFunc = OnHandshakeFailed;
	g_ssh.OnAuthenticationOKFunc = OnAuthenticationOK;
	g_ssh.OnAuthenticationFailedFunc = OnAuthenticationFailed;
	g_ssh.UseHandleInCallbacks = true;
	g_ssh.AddRxFraming("StopChar", "\n");
}

function systemShutdownFunction()
{
	// disconnect from the server
	g_ssh.Disconnect();
}

function addMessageToQueue(message)
{
	dbgPrint("addMessageToQueue()");
	if (g_cmdQueue.length<20) 
	{
		dbgPrint("addMessageToQueue() adding " + message + " to the queue");
		g_cmdQueue.push(message);
	}
	else
		dbgPrint("addMessageToQueue() queue full!");
		
	if (g_cmdQueue.length === 1) 
		sendMessage();
}

function sendMessage()
{
	dbgPrint("sendMessage()");
	if (!g_txWait)
	{
		var packet = g_cmdQueue.shift();
		dbgPrint("sendMessage() sending: " + packet);
		g_ssh.Write(packet + "\n");
		g_timer.Start(OnTimer, MESSAGE_SEND_DELAY);
		// prevent any further requests until we get a reply or a timeout
		g_txWait = true;
	}
	return;
}

function OnTimer()
{
    //  The response took too long, go on
	g_txWait = false;
	if (g_cmdQueue.length > 0) 
		sendMessage();
}


function DTune(tune)
{
	dbgPrint("Direct Tune");
	addMessageToQueue("nrsc5 " + tune);
}
function HDSub(sub)
{
	dbgPrint("HD Sub Channel");
	addMessageToQueue("nrsc5 " + sub);
}
function Disco()
{
	dbgPrint("Disconnect");
	addMessageToQueue("nrsc5 terminate");
}

function Sstring(string)
{
	dbgPrint("Sending String= " + string );
	addMessageToQueue("nrsc5" + string);
}
function Raws(string)
{
	dbgPrint("Raw String= " + string );
	addMessageToQueue(string);
}