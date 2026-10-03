# BPMN reference

`.bpmn` files are business processes in BPMN 2.0 notation. Write **only the semantic model**;
c4builder validates it, lays it out (horizontal pools and lanes, flow left to right) and
renders it in the standard bpmn.io notation — offline and deterministically.

## Source format

- Standard BPMN 2.0 XML, namespace `http://www.omg.org/spec/BPMN/20100524/MODEL`.
- **No coordinates.** Do not write a `bpmndi:BPMNDiagram` section: it is ignored anyway, the
  build always computes the layout. There is no way to hand-tune positions.
- `incoming` / `outgoing` elements are optional — connections are taken from
  `sourceRef` / `targetRef` of the flows.
- `isExecutable="false"`: this is documentation, not an executable process; no Camunda or
  Flowable extensions are needed.
- Give elements readable ids with a type prefix (`Task_CheckDocuments`, `Gateway_Decision`,
  `Flow_Approved`): every error message points to an id.

Minimal example — a pool with two lanes, an external "black-box" pool, a gateway with
labelled branches, a boundary timer and message flows:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_Order" targetNamespace="https://example.com/bpmn/order">
  <bpmn:collaboration id="Collaboration_Order">
    <bpmn:participant id="Pool_Shop" name="Shop" processRef="Process_Order" />
    <bpmn:participant id="Pool_Bank" name="Payment bank" />
    <bpmn:messageFlow id="Message_Charge" name="Charge request"
                      sourceRef="Task_Charge" targetRef="Pool_Bank" />
    <bpmn:messageFlow id="Message_Result" name="Payment result"
                      sourceRef="Pool_Bank" targetRef="Task_AwaitPayment" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Order" name="Order" isExecutable="false">
    <bpmn:laneSet id="LaneSet_Shop">
      <bpmn:lane id="Lane_Sales" name="Sales">
        <bpmn:flowNodeRef>Start_Order</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Charge</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_AwaitPayment</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Paid</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Cancelled</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Expired</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Warehouse" name="Warehouse">
        <bpmn:flowNodeRef>Task_Ship</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Shipped</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Order" name="Order placed" />
    <bpmn:sendTask id="Task_Charge" name="Request payment" />
    <bpmn:receiveTask id="Task_AwaitPayment" name="Await payment" />
    <bpmn:boundaryEvent id="Timer_PaymentTimeout" name="1 hour" attachedToRef="Task_AwaitPayment">
      <bpmn:timerEventDefinition id="TimerDef_PaymentTimeout" />
    </bpmn:boundaryEvent>
    <bpmn:exclusiveGateway id="Gateway_Paid" name="Paid?" />
    <bpmn:userTask id="Task_Ship" name="Ship order" />
    <bpmn:endEvent id="End_Shipped" name="Order shipped" />
    <bpmn:endEvent id="End_Cancelled" name="Order cancelled" />
    <bpmn:endEvent id="End_Expired" name="Payment expired" />
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="Start_Order" targetRef="Task_Charge" />
    <bpmn:sequenceFlow id="Flow_Charged" sourceRef="Task_Charge" targetRef="Task_AwaitPayment" />
    <bpmn:sequenceFlow id="Flow_Answered" sourceRef="Task_AwaitPayment" targetRef="Gateway_Paid" />
    <bpmn:sequenceFlow id="Flow_Yes" name="Yes" sourceRef="Gateway_Paid" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="Flow_No" name="No" sourceRef="Gateway_Paid" targetRef="End_Cancelled" />
    <bpmn:sequenceFlow id="Flow_Timeout" sourceRef="Timer_PaymentTimeout" targetRef="End_Expired" />
    <bpmn:sequenceFlow id="Flow_Shipped" sourceRef="Task_Ship" targetRef="End_Shipped" />
  </bpmn:process>
</bpmn:definitions>
```

Elements that render: start/end/intermediate events with timer, message, error and other
definitions, boundary events, `task`, `userTask`, `serviceTask`, `sendTask`, `receiveTask`,
`manualTask`, `scriptTask`, `businessRuleTask`, exclusive/parallel/inclusive/event-based
gateways, `subProcess`, `textAnnotation` with `association`, `dataObjectReference`.
`complexGateway` is not supported by the layout engine.

## Modelling conventions

- **Pool = organization**, **lane = role or unit inside it.** An external party whose
  internals you do not describe is a pool without `processRef` (a black box).
- **Between pools — only message flows.** Sequence flows stay inside one pool; a message
  flow may target a node or the black-box pool itself.
- **Lanes:** when a process has lanes, list every flow node in exactly one lane
  (`flowNodeRef`). Boundary events may be left out — they sit on their task.
- **Label everything:** events, tasks, participants, lanes and diverging gateways need a
  `name`. Label every outgoing flow of an exclusive/inclusive gateway (`Yes` / `No`).
- **Exactly the start and end you mean:** a process needs a start and an end event; a node
  without incoming or outgoing flows is an error, not an implicit start or end.
- **Overview plus detail** instead of one huge diagram: above ~40 nodes the picture stops
  being readable. Sub-processes are always drawn collapsed — describe their inside in a
  separate `.bpmn` on its own page.

## The loop

```bash
c4builder check "src/3 Processes/order.bpmn"
```

`check` runs the whole pipeline — parse, rules, layout and rendering — without a project.
Exit code 0 means the diagram builds; warnings are printed but do not change the code. Each
problem is one line:

```text
✗ src/3 Processes/order.bpmn: Task_Ship [no-disconnected] Element is not connected
⚠ src/3 Processes/order.bpmn: Flow_No [c4builder/gateway-flow-labels] Outgoing flow of a diverging gateway has no label
```

Format: `<file>: <element id> [<rule>] <description>`. Fix the element with that id and run
`check` again until the exit code is 0.

| Message | Fix |
|---|---|
| `[no-disconnected]`, `[no-implicit-start]`, `[no-implicit-end]` | connect the node with sequence flows (check `sourceRef`/`targetRef` spelling) |
| `[start-event-required]`, `[end-event-required]` | add the missing start or end event |
| `[label-required]` | add a `name` |
| `[c4builder/lane-membership]` | list the node in exactly one `flowNodeRef` of its process lanes |
| `[c4builder/sequence-flow-in-pool]` | replace the sequence flow between pools with a `messageFlow` in the collaboration |
| `[c4builder/message-flow-between-pools]` | a message flow inside one pool must be a sequence flow |
| `[c4builder/gateway-flow-labels]` (warning) | name the gateway's outgoing flows |
| `[no-inclusive-gateway]` (warning) | prefer exclusive or parallel gateways where possible |
| `X: unresolved reference <Y>` | element `X` refers to an id `Y` that does not exist |
| `invalid BPMN XML: …` | the file is not well-formed XML or not BPMN 2.0 |
| `layout failed: …` / `layout lost N element(s): …` | the layout engine could not place the model: simplify it, split it into overview and detail, or move the listed elements |

The rule set is fixed (bpmnlint `recommended` without `no-bpmndi`, plus the `c4builder/*`
rules) and is the same in `check` and in the build — there is no project config for it.

## Output and dependencies

- The image is `<name>.svg` (or `.png` with `diagramFormat: png`) next to the page; place
  it inline with `![title](name.bpmn)`. In `llms-full.txt` the source appears in an `xml`
  block.
- Text is measured with the bundled Nimbus Sans: the SVG is identical on every machine;
  `useSystemFonts` does not affect BPMN.
- The engine packages (`bpmn-js`, `bpmn-moddle`, `bpmnlint`, `bpmn-auto-layout`, `jsdom`)
  are optional npm dependencies, loaded only when the project has a `.bpmn`. An install with
  `--omit=optional` stops such a build with a hint to reinstall c4builder.
- Like D2, BPMN has no online renderer: `generateLocalImages` must stay `true`.
