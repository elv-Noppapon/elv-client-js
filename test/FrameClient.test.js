const {Initialize} = require("./utils/Utils");
const {
  afterAll,
  beforeAll,
  describe,
  expect,
  mockCallback,
  runTests,
  test
} = Initialize();

const {FrameClient} = require("../src/FrameClient");
const OutputLogger = require("./utils/OutputLogger");
const {RandomBytes, CreateClient, ReturnBalance} = require("./utils/Utils");

let frameClient, client, libraryId, objectId, partHash;

const CompareMethods = (frameClientMethods, elvClientMethods) => {
  const differentKeys = frameClientMethods
    .filter(x => !elvClientMethods.includes(x))
    .concat(elvClientMethods.filter(x => !frameClientMethods.includes(x)));

  if(differentKeys.length > 0) {
    console.error("DIFFERING KEYS: ");
    console.error(differentKeys);

    console.error("EXPECTED");
    console.error(JSON.stringify(elvClientMethods.sort(), null, 2));

    throw Error("MISMATCHED ALLOWED METHODS BETWEEN ELV CLIENT AND FRAME CLIENT");
  }
};

describe("Test FrameClient", () => {
  beforeAll(async () => {
    // Initialize fake window object to test the frame client
    global.window = new (require("window"))();
    global.document = global.window.document;

    frameClient = OutputLogger(
      FrameClient,
      new FrameClient(),
      ["AwaitMessage"]
    );

    client = await CreateClient("FrameClient");

    window.addEventListener("message", async (event) => {
      if(!event || !event.data || event.data.type !== "ElvFrameRequest") { return; }

      const Respond = (response) => {
        response = {
          ...response,
          type: "ElvFrameResponse"
        };

        window.postMessage(
          response,
          "*"
        );
      };

      await client.CallFromFrameMessage(event.data, Respond);
    });
  });

  afterAll(async () => {
    await ReturnBalance(client);

    // Unset fake window object
    global.window = undefined;
  });

  test("FrameClient methods match expected ElvClient methods", () => {
    CompareMethods([...frameClient.AllowedMethods(), ...frameClient.OverriddenMethods()], client.FrameAllowedMethods());
  });

  test("FrameClient methods match expected UserProfile methods", () => {
    CompareMethods(frameClient.AllowedUserProfileMethods(), client.userProfileClient.FrameAllowedMethods());
  });

  test("Call ElvClient Method", async () => {
    const result = (await client.ContentLibraries()).sort();
    const frameResult = (await frameClient.ContentLibraries()).sort();

    expect(frameResult).toBeDefined();
    expect(frameResult).toMatchObject(result);
  });

  test("Call ElvClient Method - Errors", async () => {
    console.error = mockCallback();

    try {
      // Access a library with a bad transaction hash
      const libraryId = await frameClient.CreateContentLibrary({name: "test library"});
      client.authClient.accessTransactions[client.utils.HashToAddress(libraryId)] = "0x46d637070718a3dad9367923afe3051889b7999e943d4a57ce719184b0b24164";
      await frameClient.ContentLibrary({libraryId});
    } catch(e) {
      expect(e).toMatchObject({
        name: "ElvHttpClientError",
        method: "GET",
        status: 401
      });

      expect(e.message).toBeDefined();
      expect(e.statusText).toBeDefined();
      expect(e.url).toBeDefined();
      expect(e.headers).toBeDefined();
      expect(e.headers.Authorization).toBeDefined();
    }
  });

  test("Get Account Address", async () => {
    const address = await frameClient.CurrentAccountAddress();

    expect(frameClient.utils.FormatAddress(address)).toEqual(frameClient.utils.FormatAddress(client.signer.address));
  });

  test("User Profile Methods", async () => {
    const accessLevel = await frameClient.userProfileClient.AccessLevel();
    expect(accessLevel).toEqual("prompt");
  });

  test("Pass FrameClient Request", async () => {
    const Respond = mockCallback();

    const request = {
      calledMethod: "ContentLibraries",
      args: {},
      type: "ElvFrameRequest",
      requestId: 123,
      callbackId: undefined
    };

    const expectedResult = (await client.ContentLibraries()).sort();
    const result = await frameClient.PassRequest({
      request,
      Respond
    });

    expect(result).toBeDefined();

    result.response.sort();

    expect(result).toMatchObject({
      type: "ElvFrameResponse",
      requestId: 123,
      response: expectedResult
    });
  });

  test("Call ElvClient Method With Callback", async () => {
    libraryId = await frameClient.CreateContentLibrary({name: "test frame client"});
    const createResponse = await frameClient.CreateContentObject({libraryId});
    objectId = createResponse.id;

    const uploadResult = await frameClient.UploadPart({
      libraryId,
      objectId,
      writeToken: createResponse.write_token,
      data: RandomBytes(100000),
      chunkSize: 10000,
    });

    expect(uploadResult).toBeDefined();

    await frameClient.FinalizeContentObject({libraryId, objectId, writeToken: createResponse.write_token});

    partHash = uploadResult.part.hash;

    const callback = mockCallback();
    await frameClient.DownloadPart({
      libraryId,
      objectId,
      partHash,
      chunked: true,
      chunkSize: 10000,
      callback
    });

    expect(callback).toHaveBeenCalledTimes(10);
  });

  test("Pass FrameClient Request With Callback", async () => {
    const callback = mockCallback();

    const request = {
      type: "ElvFrameRequest",
      requestId: 1234,
      calledMethod: "DownloadPart",
      args: {
        libraryId,
        objectId,
        partHash,
        chunked: true,
        chunkSize: 10000,
        callback
      },
      callbackId: 321
    };

    const result = await frameClient.PassRequest({
      request,
      Respond: callback
    });

    expect(result).toBeDefined();
    expect(result).toMatchObject({
      type: "ElvFrameResponse",
      requestId: 1234
    });
    expect(callback).toHaveBeenCalledTimes(10);
  });
});

if(!module.parent) { runTests(); }
module.exports = runTests;
